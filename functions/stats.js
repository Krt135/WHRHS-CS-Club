/**
 * Public club counts shared by the home/about stats strip (stats/public) and
 * the Projects dashboard (getClubStats), so the pages can't disagree.
 *
 * users/ and the full sponsors/ list aren't publicly readable, so the counts
 * live in a small server-written document: stats/public. The triggers below
 * recompute every count from scratch (rather than +1/-1) whenever something
 * that affects them changes, so the numbers can't drift.
 */

const {onValueWritten} = require("firebase-functions/database");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

const PUBLIC_STATS_PATH = "stats/public";

/**
 * A club member is an approved account, or any exec/admin.
 * @param {*} user Value of users/{uid}.
 * @return {boolean} True when the profile counts as a member.
 */
function isMember(user) {
  if (!user) return false;
  return user.status === "approved" || user.role === "exec" ||
    user.role === "admin";
}

/**
 * Sponsors shown on the Sponsorship Board.
 * @param {*} sponsor Value of sponsors/{id}.
 * @return {boolean} True when the sponsor is active.
 */
function isActiveSponsor(sponsor) {
  return Boolean(sponsor) && sponsor.active === true;
}

/**
 * Counts members, arcade projects (everything in games/; deleted games are
 * moved to deleted_posts/) and active sponsors.
 * @param {admin.database.Database} db Database handle.
 * @return {Promise<Object>} The stats/public payload.
 */
async function computePublicStats(db) {
  const [usersSnap, gamesSnap, sponsorsSnap] = await Promise.all([
    db.ref("users").get(),
    db.ref("games").get(),
    db.ref("sponsors").orderByChild("active").equalTo(true).get(),
  ]);

  let membersCount = 0;
  usersSnap.forEach((child) => {
    if (isMember(child.val())) membersCount++;
  });

  let activeSponsorsCount = 0;
  sponsorsSnap.forEach((child) => {
    if (isActiveSponsor(child.val())) activeSponsorsCount++;
  });

  return {
    membersCount,
    activeProjectsCount: gamesSnap.numChildren(),
    activeSponsorsCount,
    updatedAt: Date.now(),
  };
}

/**
 * Recomputes and stores stats/public.
 * @param {string} reason What triggered the refresh (for logs).
 * @return {Promise<Object>} The stored stats.
 */
async function refreshPublicStats(reason) {
  const db = admin.database();
  const stats = await computePublicStats(db);
  await db.ref(PUBLIC_STATS_PATH).set(stats);
  logger.info("Public stats refreshed", {reason, ...stats});
  return stats;
}

// Only creates/deletes change the project count (edits don't).
exports.statsOnGameWrite = onValueWritten("/games/{gameId}", (event) => {
  if (event.data.before.exists() === event.data.after.exists()) return null;
  return refreshPublicStats("game");
});

// Fires on any profile write, but only recounts when membership flips
// (sign-up approved, role change, account removed), not on bio edits.
exports.statsOnUserWrite = onValueWritten("/users/{uid}", (event) => {
  if (isMember(event.data.before.val()) === isMember(event.data.after.val())) {
    return null;
  }
  return refreshPublicStats("user");
});

exports.statsOnSponsorWrite = onValueWritten("/sponsors/{sponsorId}",
    (event) => {
      if (isActiveSponsor(event.data.before.val()) ===
          isActiveSponsor(event.data.after.val())) {
        return null;
      }
      return refreshPublicStats("sponsor");
    });

exports.isMember = isMember;
exports.computePublicStats = computePublicStats;
exports.PUBLIC_STATS_PATH = PUBLIC_STATS_PATH;
