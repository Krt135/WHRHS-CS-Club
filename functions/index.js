/**
 * WHRHS CS Club email functions (SendGrid + Secret Manager).
 *
 * Secrets / params:
 *   SENDGRID_API_KEY    - secret, set with
 *                         `firebase functions:secrets:set SENDGRID_API_KEY`
 *   SENDGRID_FROM_EMAIL - verified SendGrid sender address (prompted on
 *                         first deploy, stored in functions/.env.<project>)
 *   SITE_URL            - public site origin used in email links
 *   ANNOUNCEMENT_TEST_MODE - "true" sends announcement emails only to the
 *                         admin who posted (for safe end-to-end testing)
 */

const crypto = require("crypto");
const {setGlobalOptions} = require("firebase-functions");
const {onRequest, onCall, HttpsError} = require("firebase-functions/https");
const {onValueCreated, onValueWritten} =
  require("firebase-functions/database");
const {defineSecret, defineString} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");

admin.initializeApp();

setGlobalOptions({maxInstances: 10});

exports.getClubStats = require("./getClubStats").getClubStats;

const stats = require("./stats");
exports.statsOnGameWrite = stats.statsOnGameWrite;
exports.statsOnUserWrite = stats.statsOnUserWrite;
exports.statsOnSponsorWrite = stats.statsOnSponsorWrite;
exports.statsDailyRefresh = stats.statsDailyRefresh;

const sendgridKey = defineSecret("SENDGRID_API_KEY");
const fromEmail = defineString("SENDGRID_FROM_EMAIL", {
  description: "Verified SendGrid sender address for club emails",
});
const siteUrl = defineString("SITE_URL", {
  default: "https://whrhs-cs-club.web.app",
  description: "Public site origin used in email links (no trailing slash)",
});

const announcementTestMode = defineString("ANNOUNCEMENT_TEST_MODE", {
  default: "false",
  description: "\"true\" sends announcement emails only to the posting admin",
});

const BRAND = {coral: "#FF6B4A", dark: "#1a1a1a"};
const RATE_LIMIT_MS = 5 * 60 * 1000;
const SEND_BATCH_SIZE = 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- HELPERS ----------

/**
 * Basic email address sanity check.
 * @param {*} email Candidate address.
 * @return {boolean} True when it looks like a deliverable address.
 */
function isValidEmail(email) {
  return typeof email === "string" && email.length <= 254 &&
    EMAIL_RE.test(email);
}

/**
 * Escapes user-supplied text before it goes into email HTML.
 * @param {*} value Raw value.
 * @return {string} HTML-safe string.
 */
function escapeHtml(value) {
  return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
}

/**
 * Wraps body HTML in the shared responsive club email layout.
 * @param {{heading: string, bodyHtml: string, cta: ?{label: string,
 *   url: string}}} content Email content. Heading must be pre-escaped.
 * @return {string} Full HTML document.
 */
function renderEmail({heading, bodyHtml, cta}) {
  const base = siteUrl.value();
  const button = cta ? `
    <tr><td style="padding:8px 32px 32px;">
      <a href="${cta.url}"
        style="display:inline-block;background:${BRAND.coral};
        color:#ffffff;text-decoration:none;font-weight:600;padding:14px 28px;
        border-radius:6px;">${escapeHtml(cta.label)}</a>
    </td></tr>` : "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  @media (max-width: 620px) {
    .card { width: 100% !important; border-radius: 0 !important; }
    .pad { padding-left: 20px !important; padding-right: 20px !important; }
  }
</style></head>
<body style="margin:0;padding:0;background:#f4f4f4;
  font-family:Helvetica,Arial,sans-serif;color:${BRAND.dark};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
  style="background:#f4f4f4;padding:24px 0;"><tr><td align="center">
  <table role="presentation" class="card" width="600" cellpadding="0"
    cellspacing="0" style="max-width:600px;background:#ffffff;
    border-radius:10px;overflow:hidden;">
    <tr><td class="pad" style="background:${BRAND.dark};padding:24px 32px;
      font-family:'Courier New',monospace;font-size:18px;color:#ffffff;">
      <span style="color:${BRAND.coral};">W/</span> WHRHS CS Club
    </td></tr>
    <tr><td class="pad" style="padding:32px 32px 8px;">
      <h1 style="margin:0 0 16px;font-size:22px;color:${BRAND.dark};">
        ${heading}</h1>
      <div style="font-size:15px;line-height:1.6;">${bodyHtml}</div>
    </td></tr>
    ${button}
    <tr><td class="pad" style="padding:0 32px 32px;font-size:15px;">
      &mdash; WHRHS Computer Science Club
    </td></tr>
    <tr><td class="pad" style="background:${BRAND.dark};padding:20px 32px;
      font-size:12px;line-height:1.5;color:#bbbbbb;">
      You're receiving this because you have a WHRHS CS Club account.<br>
      <a href="${base}/account.html#email-preferences"
        style="color:${BRAND.coral};">Manage email preferences</a> or
      <a href="${base}/account.html#email-preferences"
        style="color:${BRAND.coral};">unsubscribe</a>.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

/**
 * Sends messages through SendGrid in batches. Never throws: failures are
 * logged so a bad address or SendGrid outage can't crash the trigger.
 * @param {Array<Object>} messages SendGrid message objects.
 * @return {Promise<number>} Number of messages accepted by SendGrid.
 */
async function sendEmails(messages) {
  if (!messages.length) return 0;
  sgMail.setApiKey(sendgridKey.value());

  let sent = 0;
  for (let i = 0; i < messages.length; i += SEND_BATCH_SIZE) {
    const batch = messages.slice(i, i + SEND_BATCH_SIZE);
    const results = await Promise.allSettled(
        batch.map((msg) => sgMail.send({from: fromEmail.value(), ...msg})),
    );
    results.forEach((result, j) => {
      if (result.status === "fulfilled") {
        sent++;
      } else {
        const err = result.reason;
        logger.error("SendGrid send failed", {
          to: batch[j].to,
          subject: batch[j].subject,
          code: err.code,
          errors: err.response && err.response.body &&
            err.response.body.errors,
        });
      }
    });
  }
  return sent;
}

/**
 * Atomically claims the send slot for a key, allowing at most one email per
 * key every RATE_LIMIT_MS.
 * @param {string} key Identifier (e.g. an email address).
 * @return {Promise<boolean>} True if the caller may send now.
 */
async function claimRateLimit(key) {
  const id = crypto.createHash("sha256").update(key).digest("hex");
  const ref = admin.database().ref(`emailRateLimits/${id}`);
  const now = Date.now();
  const result = await ref.transaction((last) => {
    if (last && now - last < RATE_LIMIT_MS) return; // abort
    return now;
  });
  return result.committed;
}

// ---------- a) NEW GROUP GAME -> NOTIFY EXECS/ADMINS ----------

exports.onGameUpload = onValueCreated(
    {ref: "/games/{gameId}", secrets: [sendgridKey]},
    async (event) => {
      const game = event.data.val() || {};
      const gameId = event.params.gameId;
      if (game.category !== "group") return;

      const db = admin.database();

      // The games/ rules let any signed-in user write, so confirm server-side
      // that the uploader really is an exec/admin before emailing anyone.
      const authorRole = (await db.ref(`users/${game.authorUid}/role`)
          .get()).val();
      if (authorRole !== "exec" && authorRole !== "admin") {
        logger.warn("Ignoring group game from non-exec author", {
          gameId, authorUid: game.authorUid,
        });
        return;
      }

      const snaps = await Promise.all(["admin", "exec"].map((role) =>
        db.ref("users").orderByChild("role").equalTo(role).get()));

      const recipients = [];
      snaps.forEach((snap) => snap.forEach((child) => {
        const user = child.val();
        const prefs = user.emailPreferences || {};
        if (prefs.newGames === false) return;
        if (!isValidEmail(user.email)) return;
        recipients.push(user.email);
      }));

      const title = escapeHtml(game.title || "Untitled");
      const author = escapeHtml(game.authorName || "a club member");
      const playUrl = `${siteUrl.value()}/play.html?id=` +
        encodeURIComponent(gameId);
      const html = renderEmail({
        heading: `New Group Game: ${title}`,
        bodyHtml: `<p><strong>${title}</strong> was just uploaded by
          ${author}${game.engine ? ` (${escapeHtml(game.engine)})` : ""}.</p>
          <p>Give it a play and share feedback with the team.</p>`,
        cta: {label: "Play it now", url: playUrl},
      });

      const sent = await sendEmails([...new Set(recipients)].map((to) => ({
        to,
        subject: `New Group Game: ${game.title || "Untitled"}`,
        html,
        text: `New group game "${game.title}" by ${game.authorName}. ` +
          `Play: ${playUrl}`,
      })));
      logger.info("Group game notification sent", {
        gameId, recipients: recipients.length, sent,
      });
    },
);

// ---------- b) NEW PROFILE -> WELCOME EMAIL ----------
// There's no 2nd Gen "auth user created" trigger (only blocking functions,
// which need Identity Platform), so this fires on the users/{uid} profile
// that both email and Google sign-up create. The address comes from Auth,
// not the client-written profile, so it can't be pointed at someone else.

exports.onUserSignup = onValueCreated(
    {ref: "/users/{uid}", secrets: [sendgridKey]},
    async (event) => {
      const uid = event.params.uid;

      // A denied user who signs up again gets a fresh profile; only welcome
      // each account once.
      const claim = await admin.database().ref(`welcomeEmailsSent/${uid}`)
          .transaction((sentAt) => sentAt ? undefined : Date.now());
      if (!claim.committed) return;

      let user;
      try {
        user = await admin.auth().getUser(uid);
      } catch (err) {
        logger.warn("Skipping welcome email: no auth user", {
          uid, code: err.code,
        });
        return;
      }

      if (!isValidEmail(user.email)) {
        logger.info("Skipping welcome email: no valid address", {
          uid: user.uid,
        });
        return;
      }

      const base = siteUrl.value();
      const name = escapeHtml(user.displayName || "there");
      const html = renderEmail({
        heading: "Welcome to WHRHS CS Club!",
        bodyHtml: `<p>Hi ${name},</p>
          <p>Thanks for signing up. Your membership request has been sent to
          the Exec Board. You'll be able to log in once an exec approves
          it.</p>
          <p><strong>Getting started</strong></p>
          <ol style="padding-left:20px;margin:0 0 16px;">
            <li>Log in and fill out your profile on the
              <a href="${base}/account.html" style="color:${BRAND.coral};">
              account page</a>.</li>
            <li>Browse member builds on the
              <a href="${base}/projects.html" style="color:${BRAND.coral};">
              projects page</a> and upload your own.</li>
            <li>Check <a href="${base}/events.html"
              style="color:${BRAND.coral};">upcoming events</a> and
              competitions.</li>
          </ol>`,
        cta: {label: "Explore resources", url: `${base}/resources.html`},
      });

      await sendEmails([{
        to: user.email,
        subject: "Welcome to WHRHS CS Club!",
        html,
        text: `Welcome to WHRHS CS Club! Your membership request is pending ` +
          `exec approval. Resources: ${base}/resources.html`,
      }]);
    },
);

// ---------- c) PASSWORD RESET REQUEST ----------
// Uses Firebase Auth's own reset code (single-use, expires after 1 hour) so
// reset-password.html can finish the reset with confirmPasswordReset().

exports.onPasswordReset = onRequest(
    {secrets: [sendgridKey], cors: true},
    async (req, res) => {
      if (req.method !== "POST") {
        res.status(405).json({error: "Method not allowed"});
        return;
      }

      const email = String((req.body && req.body.email) || "")
          .trim().toLowerCase();
      if (!isValidEmail(email)) {
        res.status(400).json({error: "Please enter a valid email address."});
        return;
      }

      // Same response whether or not the account exists, so this endpoint
      // can't be used to discover which emails are registered.
      const genericOk = {
        message: "If an account exists for that email, a reset link is on " +
          "its way.",
      };

      try {
        if (!(await claimRateLimit(`reset:${email}`))) {
          res.status(429).json({
            error: "A reset email was sent recently. Please wait a few " +
              "minutes and try again.",
          });
          return;
        }

        let firebaseLink;
        try {
          firebaseLink = await admin.auth().generatePasswordResetLink(email);
        } catch (err) {
          if (err.code === "auth/user-not-found" ||
              err.code === "auth/email-not-found") {
            res.status(200).json(genericOk);
            return;
          }
          throw err;
        }

        const oobCode = new URL(firebaseLink).searchParams.get("oobCode");
        const resetUrl = `${siteUrl.value()}/reset-password.html` +
          `?oobCode=${encodeURIComponent(oobCode)}`;
        const html = renderEmail({
          heading: "Reset your password",
          bodyHtml: `<p>We got a request to reset the password for
            <strong>${escapeHtml(email)}</strong>.</p>
            <p>This link expires in 1 hour and can only be used once. If you
            didn't ask for this, you can ignore this email.</p>`,
          cta: {label: "Choose a new password", url: resetUrl},
        });

        const sent = await sendEmails([{
          to: email,
          subject: "Reset your WHRHS CS Club password",
          html,
          text: `Reset your password (expires in 1 hour): ${resetUrl}`,
        }]);

        if (!sent) {
          res.status(502).json({
            error: "We couldn't send the email right now. Please try again " +
              "later.",
          });
          return;
        }
        res.status(200).json(genericOk);
      } catch (err) {
        logger.error("Password reset request failed", {
          code: err.code, message: err.message,
        });
        res.status(500).json({error: "Something went wrong. Try again later."});
      }
    },
);

// ---------- d) ROLE -> AUTH TOKEN CLAIM ----------
// Storage rules can't read the Realtime Database, so admin-only uploads
// (sponsor logos) check a `role` custom claim mirrored from users/{uid}/role.

/**
 * Copies a user's database role onto their auth token.
 * @param {string} uid User id.
 * @param {*} role Value of users/{uid}/role (null when removed).
 * @return {Promise<?string>} The role now on the token.
 */
async function syncRoleClaim(uid, role) {
  let user;
  try {
    user = await admin.auth().getUser(uid);
  } catch (err) {
    if (err.code === "auth/user-not-found") return null;
    throw err;
  }

  const next = typeof role === "string" ? role : null;
  const claims = {...(user.customClaims || {})};
  if ((claims.role || null) === next) return next;

  if (next) claims.role = next;
  else delete claims.role;
  await admin.auth().setCustomUserClaims(uid, claims);
  logger.info("Role claim updated", {uid, role: next});
  return next;
}

exports.onRoleChange = onValueWritten("/users/{uid}/role", (event) =>
  syncRoleClaim(event.params.uid, event.data.after.val()));

// Roles set before onRoleChange was deployed never fired it, so the admin
// panel calls this to make sure the caller's claim is current.
exports.refreshRoleClaim = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }
  const uid = request.auth.uid;
  const role = (await admin.database().ref(`users/${uid}/role`).get()).val();
  return {role: await syncRoleClaim(uid, role)};
});

// ---------- e) ADMIN ANNOUNCEMENT -> EMAIL MEMBERS ----------
// The announcement itself is written by the admin's browser (database rules
// enforce the admin role); this callable then emails it. Callable functions
// verify the Firebase ID token for us, and we re-check the role here.

const ANNOUNCEMENT_ID_RE = /^[-\w]{1,64}$/;
const SAFE_URL_RE = /^(https?:\/\/|mailto:)/i;

/**
 * Collects the Auth email of every approved member, exec and admin who has
 * not opted out of announcement emails.
 * @return {Promise<Array<string>>} Unique recipient addresses.
 */
async function getAnnouncementRecipients() {
  const usersSnap = await admin.database().ref("users").get();
  const uids = [];
  usersSnap.forEach((child) => {
    const user = child.val() || {};
    const isMember = user.status === "approved" ||
      user.role === "exec" || user.role === "admin";
    const prefs = user.emailPreferences || {};
    if (isMember && prefs.announcements !== false) uids.push(child.key);
  });

  // Use the Auth address rather than the client-editable profile email, so
  // nobody can point club mail at someone else's inbox.
  const emails = new Set();
  for (let i = 0; i < uids.length; i += 100) {
    const result = await admin.auth().getUsers(
        uids.slice(i, i + 100).map((uid) => ({uid})));
    result.users.forEach((u) => {
      if (!u.disabled && isValidEmail(u.email)) {
        emails.add(u.email.toLowerCase());
      }
    });
  }
  return [...emails];
}

exports.sendAnnouncementEmail = onCall(
    {secrets: [sendgridKey], timeoutSeconds: 300},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Sign in first.");
      }
      const callerUid = request.auth.uid;
      const id = String((request.data && request.data.id) || "");
      if (!ANNOUNCEMENT_ID_RE.test(id)) {
        throw new HttpsError("invalid-argument", "Missing announcement id.");
      }

      const db = admin.database();
      const role = (await db.ref(`users/${callerUid}/role`).get()).val();
      if (role !== "admin") {
        throw new HttpsError("permission-denied", "Admins only.");
      }

      const ann = (await db.ref(`announcements/${id}`).get()).val();
      if (!ann || typeof ann.message !== "string") {
        throw new HttpsError("not-found", "Announcement not found.");
      }
      if (ann.emailSent === true) {
        throw new HttpsError("already-exists",
            "This announcement was already emailed.");
      }

      // One email blast per announcement, even with retries/double clicks.
      const claimRef = db.ref(`announcementEmails/${id}`);
      const claim = await claimRef.transaction((current) => current ?
        undefined : {by: callerUid, at: Date.now()});
      if (!claim.committed) {
        throw new HttpsError("already-exists",
            "This announcement is already being emailed.");
      }

      const testMode = announcementTestMode.value() === "true";
      let recipients;
      try {
        if (testMode) {
          const caller = await admin.auth().getUser(callerUid);
          recipients = isValidEmail(caller.email) ? [caller.email] : [];
        } else {
          recipients = await getAnnouncementRecipients();
        }
      } catch (err) {
        await claimRef.remove();
        logger.error("Announcement recipient lookup failed", {
          id, code: err.code, message: err.message,
        });
        throw new HttpsError("internal", "Couldn't load the member list.");
      }

      const urgent = ann.type === "urgent";
      const url = typeof ann.url === "string" && SAFE_URL_RE.test(ann.url) ?
        ann.url : "";
      const linkText = (typeof ann.linkText === "string" &&
        ann.linkText.trim()) || "Learn more";
      const preview = ann.message.length > 60 ?
        `${ann.message.slice(0, 57).trimEnd()}...` : ann.message;

      const html = renderEmail({
        heading: urgent ? "Urgent club announcement" : "Club announcement",
        bodyHtml: `<p style="white-space:pre-line;margin:0 0 16px;">` +
          `${escapeHtml(ann.message)}</p>`,
        cta: url ? {label: linkText, url: escapeHtml(url)} : null,
      });
      const subject = `${urgent ? "[URGENT] " : ""}WHRHS CS Club: ${preview}`;
      const text = `${ann.message}${url ? `\n\n${linkText}: ${url}` : ""}` +
        `\n\nManage email preferences: ${siteUrl.value()}` +
        "/account.html#email-preferences";

      // One message per recipient so addresses are never shared.
      const sent = await sendEmails(recipients.map((to) => ({
        to, subject, html, text,
      })));

      if (recipients.length && !sent) {
        // Nothing went out; release the claim so the admin can retry.
        await claimRef.remove();
        throw new HttpsError("unavailable",
            "SendGrid didn't accept any emails. Check the function logs.");
      }

      await claimRef.update({sent, recipients: recipients.length, testMode});
      // Only flag announcements that still exist, so a delete mid-send can't
      // leave a half-empty record behind.
      await db.ref(`announcements/${id}`).transaction((current) => {
        if (current) current.emailSent = true;
        return current;
      });

      logger.info("Announcement email sent", {
        id, recipients: recipients.length, sent, testMode,
      });
      return {sent, recipients: recipients.length, testMode};
    },
);
