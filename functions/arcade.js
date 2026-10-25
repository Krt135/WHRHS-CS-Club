/**
 * Arcade lock: games can't be played during school hours.
 *
 * Weekdays 7:30 AM - 2:15 PM America/New_York are locked; every other time
 * (and all weekend) is open. An exec/admin can unlock the Arcade for everyone
 * until midnight with the override code.
 *
 * Game builds live in a private Storage folder (games/{uid}/{gameId}/) and are
 * only reachable through this function, which checks the lock on every file
 * request. Games are served from the Cloud Functions domain, not the site's,
 * so uploaded game code never runs on the same origin as member logins.
 *
 * Windows download builds live in downloads/{uid}/{gameId}/build.zip, also
 * private. They are too large to stream through a function, so /download
 * answers with a short-lived signed URL, and only while the Arcade is open.
 *
 * Routes on the `arcade` function:
 *   GET /status              - {open, reason, overrideUntil, serverTime}
 *                              (also at /api/arcade/status via Hosting)
 *   GET /game/{gameId}/{path} - a file from the game's build, or 423 Locked
 *   GET /download/{gameId}   - 302 to a 5-minute signed URL for an approved
 *                              download build, or 423 Locked / 404. The
 *                              stored object must still be the generation
 *                              an exec approved (games/{id}/buildGeneration).
 *   GET /download/{gameId}?review=1 with "Authorization: Bearer <ID token>"
 *                            - exec/admin only: {url, generation} for a
 *                              build in any review status, so it can be
 *                              checked before approval. Also 423 while
 *                              locked.
 *
 * Callable `approveDownload` ({gameId, decision, generation}): exec/admin
 * approve or reject a download build. Approval pins the reviewed object
 * generation; the database rules let only this function approve.
 *
 * Secrets:
 *   ARCADE_OVERRIDE_HASH - hex SHA-256 of the override code. Set it with
 *     `firebase functions:secrets:set ARCADE_OVERRIDE_HASH`
 */

const crypto = require("crypto");
const {onRequest, onCall, HttpsError} = require("firebase-functions/https");
const {onValueDeleted} = require("firebase-functions/database");
const {defineSecret} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

const CLUB_TIME_ZONE = "America/New_York";
const LOCK_START_MINUTE = 7 * 60 + 30; // 7:30 AM
const LOCK_END_MINUTE = 14 * 60 + 15; // 2:15 PM (first open minute)

const OVERRIDE_PATH = "arcadeOverride";
const ATTEMPTS_PATH = "arcadeOverrideAttempts";
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 60 * 60 * 1000;
const MAX_CODE_LENGTH = 200;
const ID_RE = /^[-\w]{1,128}$/;
const DOWNLOAD_URL_TTL_MS = 5 * 60 * 1000;
// Never served from a WebGL build, even if an old upload contains one:
// executables, scripts and archives belong in a reviewed download build.
const BLOCKED_FILE_RE =
  /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|jar|dll|zip|7z|rar)(\.(br|gz))?$/i;

const LOCK_MESSAGE = "The Arcade is restricted during school hours and " +
  "cannot be played right now. It unlocks at 2:15 PM on school days.";

const LOCK_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Arcade locked</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;
background:#0a0a0a;color:#ddd;font:15px/1.5 monospace;padding:24px;
box-sizing:border-box;text-align:center}</style></head>
<body><p>${LOCK_MESSAGE}</p></body></html>
`;

const overrideHash = defineSecret("ARCADE_OVERRIDE_HASH");

// ---------- TIME ----------

const WEEKDAYS = {Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6};
const clockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: CLUB_TIME_ZONE,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * Wall-clock date and time in the club's time zone.
 * @param {number} ms Epoch milliseconds.
 * @return {Object} weekday (0 = Sunday), year, month, day, hour, minute,
 *   second.
 */
function clubClock(ms) {
  const parts = {};
  for (const {type, value} of clockFormat.formatToParts(new Date(ms))) {
    parts[type] = value;
  }
  return {
    weekday: WEEKDAYS[parts.weekday],
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * True on weekdays from 7:30 AM up to (not including) 2:15 PM, New York time.
 * @param {number} ms Epoch milliseconds.
 * @return {boolean} Whether school hours are in effect.
 */
function isSchoolHours(ms) {
  const c = clubClock(ms);
  if (c.weekday === 0 || c.weekday === 6) return false;
  const minute = c.hour * 60 + c.minute;
  return minute >= LOCK_START_MINUTE && minute < LOCK_END_MINUTE;
}

/**
 * Milliseconds the club's time zone is ahead of UTC at an instant
 * (negative for New York).
 * @param {number} ms Epoch milliseconds.
 * @return {number} Offset in milliseconds.
 */
function clubOffset(ms) {
  const c = clubClock(ms);
  const wall = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute,
      c.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

/**
 * The next 12:00 AM in New York after an instant. Handles DST: the second
 * pass corrects the offset when the day crosses a clock change.
 * @param {number} ms Epoch milliseconds.
 * @return {number} Epoch milliseconds of the next local midnight.
 */
function nextClubMidnight(ms) {
  const c = clubClock(ms);
  const wallMidnight = Date.UTC(c.year, c.month - 1, c.day + 1);
  let result = wallMidnight - clubOffset(wallMidnight);
  result = wallMidnight - clubOffset(result);
  return result;
}

/**
 * Whether the Arcade is open at an instant.
 * @param {number} now Epoch milliseconds.
 * @param {*} overrideUntil Stored override expiry (epoch ms), if any.
 * @return {Object} {open, reason, overrideUntil}; reason is "override",
 *   "school-hours" or "schedule".
 */
function arcadeStatus(now, overrideUntil) {
  if (typeof overrideUntil === "number" && now < overrideUntil) {
    return {open: true, reason: "override", overrideUntil};
  }
  if (isSchoolHours(now)) {
    return {open: false, reason: "school-hours", overrideUntil: null};
  }
  return {open: true, reason: "schedule", overrideUntil: null};
}

/**
 * Current time. The local emulator accepts a fake time (ISO string or epoch
 * ms) so the lock can be tested at any hour; deployed functions ignore it.
 * @param {*} fake Optional fake time from the request.
 * @return {number} Epoch milliseconds.
 */
function currentTime(fake) {
  if (process.env.FUNCTIONS_EMULATOR === "true" && fake) {
    const asNumber = Number(fake);
    const parsed = Number.isFinite(asNumber) ? asNumber : Date.parse(fake);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

// ---------- OVERRIDE CODE ----------

/**
 * Compares a code against the stored SHA-256 hash in constant time.
 * @param {string} code Code typed by the exec.
 * @param {string} expectedHex Hex SHA-256 from the secret.
 * @return {boolean} True when the hash matches.
 */
function codeMatches(code, expectedHex) {
  const hex = String(expectedHex || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;
  const expected = Buffer.from(hex, "hex");
  const actual = crypto.createHash("sha256").update(code, "utf8").digest();
  return crypto.timingSafeEqual(actual, expected);
}

// ---------- HTTP: STATUS + GAME FILES ----------

/**
 * Splits /game/{gameId}/{path} into its parts. Returns null for anything
 * that isn't a plain relative file path inside the game's folder.
 * @param {string} rest Request path after "/game/".
 * @return {?Object} {gameId, filePath}; filePath is "" for the bare folder.
 */
function parseGamePath(rest) {
  const slash = rest.indexOf("/");
  const gameId = slash === -1 ? rest : rest.slice(0, slash);
  if (!ID_RE.test(gameId)) return null;
  if (slash === -1) return {gameId, filePath: null};

  let filePath;
  try {
    filePath = decodeURIComponent(rest.slice(slash + 1));
  } catch (err) {
    return null;
  }
  if (filePath === "") return {gameId, filePath: ""};
  const segments = filePath.split("/");
  if (/[\\\0]/.test(filePath) ||
      segments.some((s) => s === "" || s === "." || s === "..")) {
    return null;
  }
  return {gameId, filePath};
}

/**
 * Storage path of a download game's build. Built from the record's author
 * and id, never from anything the client sends.
 * @param {string} authorUid Game author.
 * @param {string} gameId Game id.
 * @return {string} Object path in the default bucket.
 */
function downloadPath(authorUid, gameId) {
  return `downloads/${authorUid}/${gameId}/build.zip`;
}

/**
 * File name for a downloaded build: the title reduced to letters, digits,
 * dots, dashes and underscores, so it is safe inside Content-Disposition.
 * @param {*} title Game title from the record.
 * @return {string} e.g. "Loaded-Dice-windows.zip".
 */
function downloadFilename(title) {
  const safe = String(title || "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 60)
      .replace(/[-.]+$/, "");
  return `${safe || "game"}-windows.zip`;
}

/**
 * Builds the request handler. Data access is injected so tests can run it
 * without Firebase.
 * @param {Object} deps now(fake), getOverrideUntil(), getGame(id),
 *   openFile(storagePath) -> ?{metadata, createReadStream()},
 *   statDownload(storagePath) -> ?{generation, size} (null when missing),
 *   signDownload(storagePath, filename, ttlMs) -> url,
 *   verifyIdToken(token) -> {uid}, getRole(uid).
 * @return {function(Object, Object): Promise<void>} Express-style handler.
 */
function createArcadeHandler(deps) {
  /**
   * The exec/admin making a review request, from the Bearer ID token.
   * @param {Object} req Request.
   * @return {Promise<number>} 0 when allowed, else the HTTP status to send.
   */
  async function reviewerError(req) {
    const header = (req.get && req.get("Authorization")) || "";
    const match = /^Bearer (\S+)$/.exec(header);
    if (!match) return 401;
    let uid;
    try {
      uid = (await deps.verifyIdToken(match[1])).uid;
    } catch (err) {
      return 401;
    }
    const role = await deps.getRole(uid);
    return role === "exec" || role === "admin" ? 0 : 403;
  }

  /**
   * GET /download/{gameId}. The lock has already been checked.
   * @param {Object} req Request.
   * @param {Object} res Response.
   * @param {string} gameId Requested id (unvalidated).
   * @return {Promise<void>}
   */
  async function sendDownload(req, res, gameId) {
    if (!ID_RE.test(gameId)) {
      res.status(404).json({error: "Not found"});
      return;
    }
    const review = req.query && req.query.review === "1";
    try {
      if (review) {
        const code = await reviewerError(req);
        if (code) {
          res.status(code).json({error: code === 401 ?
            "Sign in first." : "Exec board only."});
          return;
        }
      }

      const game = await deps.getGame(gameId);
      // Only download builds, and only approved ones unless an exec is
      // reviewing. Pending and rejected builds look the same as missing.
      if (!game || game.format !== "download" ||
          !ID_RE.test(game.authorUid || "") ||
          (!review && game.status !== "approved")) {
        res.status(404).json({error: "Not found"});
        return;
      }

      // Players only get the exact object an exec approved. Clients can't
      // overwrite a build, but this also catches a build uploaded after
      // the record was approved.
      const storagePath = downloadPath(game.authorUid, gameId);
      const stat = await deps.statDownload(storagePath);
      const generation = stat ? String(stat.generation) : null;
      if (!generation || (!review &&
          generation !== game.buildGeneration)) {
        res.status(404).json({error: "Not found"});
        return;
      }

      const url = await deps.signDownload(storagePath,
          downloadFilename(game.title), DOWNLOAD_URL_TTL_MS);

      logger.info("Arcade download issued", {gameId, review, generation});
      // The panel sends `generation` back with its approval, so the build
      // approved is the one this exec downloaded.
      if (review) res.status(200).json({url, generation});
      else res.redirect(302, url);
    } catch (err) {
      // `message` would collide with the log entry's own message field.
      logger.error("Arcade download request failed", {
        gameId, error: err.message,
      });
      res.status(500).json({error: "Server error"});
    }
  }

  return async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(405).json({error: "Method not allowed"});
      return;
    }

    // Hosting forwards /api/arcade/status with its full path.
    const path = req.path.replace(/^\/api\/arcade(?=\/)/, "");
    const now = deps.now(req.query && req.query.now);

    let status;
    try {
      status = arcadeStatus(now, await deps.getOverrideUntil());
    } catch (err) {
      logger.error("Arcade status lookup failed", {message: err.message});
      res.status(500).json({error: "Arcade status unavailable"});
      return;
    }

    if (path === "/status") {
      res.status(200).json({...status, serverTime: now});
      return;
    }

    const isDownload = path.startsWith("/download/");
    if (!path.startsWith("/game/") && !isDownload) {
      res.status(404).json({error: "Not found"});
      return;
    }

    // Check the lock before touching the game, so a locked request never
    // reads or returns any part of it (or a link to it).
    if (!status.open) {
      res.status(423).type("html").send(LOCK_PAGE);
      return;
    }

    if (isDownload) {
      await sendDownload(req, res, path.slice("/download/".length));
      return;
    }

    const parsed = parseGamePath(path.slice("/game/".length));
    if (!parsed) {
      res.status(404).json({error: "Not found"});
      return;
    }
    // Relative asset paths in the build need the folder URL to end in "/".
    if (parsed.filePath === null) {
      res.redirect(302, `${parsed.gameId}/index.html`);
      return;
    }
    if (parsed.filePath === "") {
      res.redirect(302, "index.html");
      return;
    }
    if (BLOCKED_FILE_RE.test(parsed.filePath)) {
      res.status(404).json({error: "Not found"});
      return;
    }

    try {
      const game = await deps.getGame(parsed.gameId);
      // External-link games aren't ours to serve.
      if (!game || game.type !== "game" || !ID_RE.test(game.authorUid || "")) {
        res.status(404).json({error: "Not found"});
        return;
      }

      const file = await deps.openFile(
          `games/${game.authorUid}/${parsed.gameId}/${parsed.filePath}`);
      if (!file) {
        res.status(404).json({error: "Not found"});
        return;
      }

      const meta = file.metadata;
      res.status(200);
      res.set("Content-Type", meta.contentType || "application/octet-stream");
      // Unity's .br/.gz files are stored with Content-Encoding and sent
      // still compressed, so the browser decompresses them natively.
      if (meta.contentEncoding) {
        res.set("Content-Encoding", meta.contentEncoding);
      }
      if (meta.size !== undefined) res.set("Content-Length", String(meta.size));

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      await new Promise((resolve) => {
        const stream = file.createReadStream();
        stream.on("error", (err) => {
          logger.error("Arcade file stream failed", {
            gameId: parsed.gameId, message: err.message,
          });
          res.destroy(err);
          resolve();
        });
        res.on("finish", resolve);
        res.on("close", resolve);
        stream.pipe(res);
      });
    } catch (err) {
      logger.error("Arcade game request failed", {
        gameId: parsed.gameId, message: err.message,
      });
      if (!res.headersSent) res.status(500).json({error: "Server error"});
      else res.destroy(err);
    }
  };
}

/**
 * Reads the stored override expiry.
 * @return {Promise<*>} Epoch ms, or null when no override is set.
 */
async function readOverrideUntil() {
  return (await admin.database().ref(`${OVERRIDE_PATH}/expiresAt`).get())
      .val();
}

/**
 * Generation and size of a stored object.
 * @param {string} storagePath Object path in the default bucket.
 * @return {Promise<?Object>} {generation, size}, or null when missing.
 */
async function statDownloadObject(storagePath) {
  try {
    const [meta] = await admin.storage().bucket().file(storagePath)
        .getMetadata();
    return {generation: String(meta.generation), size: Number(meta.size)};
  } catch (err) {
    if (err.code === 404) return null;
    throw err;
  }
}

// checkRevoked: a signed-out or disabled exec's token stops working now,
// not when it expires.
const verifyIdTokenRevocable = (token) =>
  admin.auth().verifyIdToken(token, true);

const readRole = async (uid) =>
  (await admin.database().ref(`users/${uid}/role`).get()).val();

const handler = createArcadeHandler({
  now: currentTime,
  getOverrideUntil: readOverrideUntil,
  getGame: async (gameId) =>
    (await admin.database().ref(`games/${gameId}`).get()).val(),
  openFile: async (storagePath) => {
    const file = admin.storage().bucket().file(storagePath);
    let metadata;
    try {
      [metadata] = await file.getMetadata();
    } catch (err) {
      if (err.code === 404) return null;
      throw err;
    }
    return {
      metadata,
      // decompress: false keeps gzip objects as stored, matching the
      // Content-Encoding header we send.
      createReadStream: () => file.createReadStream({decompress: false}),
    };
  },
  statDownload: statDownloadObject,
  signDownload: async (storagePath, filename, ttlMs) => {
    const file = admin.storage().bucket().file(storagePath);
    // Signing uses the function's service account (IAM signBlob), so it
    // needs roles/iam.serviceAccountTokenCreator on itself. See README.
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      // The real clock, not the lock's (which the emulator can fake).
      expires: Date.now() + ttlMs,
      responseDisposition: `attachment; filename="${filename}"`,
    });
    return url;
  },
  verifyIdToken: verifyIdTokenRevocable,
  getRole: readRole,
});

exports.arcade = onRequest(
    {cors: true, timeoutSeconds: 120, memory: "256MiB"}, handler);

// ---------- TRIGGER: GAME FILE CLEANUP ----------

/**
 * Deletes a game's Storage files once it is permanently deleted from
 * moderation (deleted_posts/{id} removed): its card cover
 * (covers/{uid}/{id}/) and, for a Windows download, its build.zip. Clients
 * can't delete downloads/ themselves (storage.rules), so this is the only
 * way a build goes away. Restoring a game also removes its deleted_posts
 * node, but writes games/{id} back first, so a game that exists again is
 * skipped and keeps its files.
 * Only a record stored under its own game id counts (an author's soft
 * delete always is; the rules require it), and the paths are built from
 * the record's authorUid, so a stray record can't point at another game.
 * @param {Object} post The deleted deleted_posts/{id} value.
 * @param {string} postId Its key under deleted_posts.
 * @param {Object} deps gameExists(id), deleteFile(storagePath),
 *   deletePrefix(prefix).
 * @return {Promise<Array<string>>} Deleted paths and prefixes (empty when
 *   skipped).
 */
async function cleanUpGameFiles(post, postId, deps) {
  if (!post || post._deletedFrom !== "games") return [];
  const gameId = post._originalId;
  if (!ID_RE.test(gameId || "") || gameId !== postId ||
      !ID_RE.test(post.authorUid || "")) {
    return [];
  }
  if (await deps.gameExists(gameId)) return [];
  const deleted = [];
  // Trailing slash: game "abc" must not match "abcd".
  const coverPrefix = `covers/${post.authorUid}/${gameId}/`;
  await deps.deletePrefix(coverPrefix);
  deleted.push(coverPrefix);
  if (post.format === "download") {
    const storagePath = downloadPath(post.authorUid, gameId);
    await deps.deleteFile(storagePath);
    deleted.push(storagePath);
  }
  return deleted;
}

// The export name stays the same so deploying replaces the existing trigger.
exports.cleanUpDownloadBuild = onValueDeleted("/deleted_posts/{postId}",
    async (event) => {
      const bucket = admin.storage().bucket();
      const deps = {
        gameExists: async (id) =>
          (await admin.database().ref(`games/${id}`).get()).exists(),
        deleteFile: (p) => bucket.file(p).delete({ignoreNotFound: true}),
        deletePrefix: (prefix) => bucket.deleteFiles({prefix}),
      };
      const deleted = await cleanUpGameFiles(event.data.val(),
          event.params.postId, deps);
      if (deleted.length) {
        logger.info("Game files deleted", {deleted});
      }
    });

// ---------- CALLABLE: DOWNLOAD REVIEW ----------

/**
 * Builds the approveDownload callable. Data access is injected so tests can
 * run it without Firebase.
 * @param {Object} deps verifyIdToken(token) -> {uid} (checks revocation),
 *   getRole(uid), getGame(id), statDownload(storagePath),
 *   saveReview(gameId, fields).
 * @return {function(Object): Promise<Object>} Callable handler.
 */
function createDownloadReview(deps) {
  return async (request) => {
    // The callable framework has verified the token, but not whether it
    // was revoked, so check the raw one again.
    const header = (request.rawRequest && request.rawRequest.get &&
      request.rawRequest.get("Authorization")) || "";
    const match = /^Bearer (\S+)$/.exec(header);
    if (!request.auth || !match) {
      throw new HttpsError("unauthenticated", "Sign in first.");
    }
    let uid;
    try {
      uid = (await deps.verifyIdToken(match[1])).uid;
    } catch (err) {
      throw new HttpsError("unauthenticated", "Sign in again.");
    }
    const role = await deps.getRole(uid);
    if (role !== "exec" && role !== "admin") {
      throw new HttpsError("permission-denied", "Exec board only.");
    }

    const data = request.data || {};
    const gameId = typeof data.gameId === "string" ? data.gameId : "";
    if (!ID_RE.test(gameId) ||
        (data.decision !== "approved" && data.decision !== "rejected")) {
      throw new HttpsError("invalid-argument", "Bad request.");
    }
    const game = await deps.getGame(gameId);
    if (!game || game.format !== "download" ||
        !ID_RE.test(game.authorUid || "")) {
      throw new HttpsError("not-found", "No such download game.");
    }

    if (data.decision === "rejected") {
      await deps.saveReview(gameId, {status: "rejected",
        buildGeneration: null});
      logger.info("Download build rejected", {gameId, uid});
      return {status: "rejected"};
    }

    const stat = await deps.statDownload(downloadPath(game.authorUid, gameId));
    if (!stat) {
      throw new HttpsError("failed-precondition",
          "No build has been uploaded for this game.");
    }
    const generation = String(stat.generation);
    if (typeof data.generation !== "string" ||
        data.generation !== generation) {
      throw new HttpsError("failed-precondition",
          "The build changed since you downloaded it. Download it again.");
    }
    await deps.saveReview(gameId, {status: "approved",
      buildGeneration: generation, fileSize: stat.size});
    logger.info("Download build approved", {gameId, uid, generation});
    return {status: "approved"};
  };
}

exports.approveDownload = onCall(createDownloadReview({
  verifyIdToken: verifyIdTokenRevocable,
  getRole: readRole,
  getGame: async (gameId) =>
    (await admin.database().ref(`games/${gameId}`).get()).val(),
  statDownload: statDownloadObject,
  saveReview: (gameId, fields) =>
    admin.database().ref(`games/${gameId}`).update(fields),
}));

// ---------- CALLABLE: EXEC OVERRIDE ----------

exports.setArcadeOverride = onCall({secrets: [overrideHash]},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Sign in first.");
      }
      const uid = request.auth.uid;
      const db = admin.database();
      const role = (await db.ref(`users/${uid}/role`).get()).val();
      if (role !== "exec" && role !== "admin") {
        throw new HttpsError("permission-denied", "Exec board only.");
      }

      const data = request.data || {};
      const now = currentTime(data.now);

      // Ending an override only makes the Arcade stricter, so it needs the
      // role but not the code.
      if (data.action === "clear") {
        await db.ref(OVERRIDE_PATH).remove();
        logger.info("Arcade override cleared", {uid});
        return {overrideUntil: null};
      }

      const code = typeof data.code === "string" ? data.code.trim() : "";
      if (!code || code.length > MAX_CODE_LENGTH) {
        throw new HttpsError("invalid-argument", "Enter the override code.");
      }

      // Count every attempt, so a short code can't be guessed online.
      const attemptsRef = db.ref(`${ATTEMPTS_PATH}/${uid}`);
      const attempt = await attemptsRef.transaction((current) => {
        const fresh = !current ||
          now - current.windowStart >= ATTEMPT_WINDOW_MS;
        const windowStart = fresh ? now : current.windowStart;
        const count = fresh ? 0 : current.count;
        if (count >= MAX_ATTEMPTS) return undefined;
        return {windowStart, count: count + 1};
      });
      if (!attempt.committed) {
        throw new HttpsError("resource-exhausted",
            "Too many attempts. Try again in an hour.");
      }

      if (!codeMatches(code, overrideHash.value())) {
        logger.warn("Wrong Arcade override code", {uid});
        throw new HttpsError("permission-denied", "That code is not correct.");
      }

      await attemptsRef.remove();
      const expiresAt = nextClubMidnight(now);
      await db.ref(OVERRIDE_PATH).set({expiresAt, setBy: uid, setAt: now});
      logger.info("Arcade override set", {uid, expiresAt});
      return {overrideUntil: expiresAt};
    },
);

exports.LOCK_MESSAGE = LOCK_MESSAGE;
exports.isSchoolHours = isSchoolHours;
exports.nextClubMidnight = nextClubMidnight;
exports.arcadeStatus = arcadeStatus;
exports.codeMatches = codeMatches;
exports.parseGamePath = parseGamePath;
exports.createArcadeHandler = createArcadeHandler;
exports.createDownloadReview = createDownloadReview;
exports.downloadFilename = downloadFilename;
exports.cleanUpGameFiles = cleanUpGameFiles;
