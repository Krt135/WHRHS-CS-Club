/**
 * Public club stats for the Projects page dashboard.
 *
 * users/ isn't publicly readable, so member counts have to come from the
 * server. Results are cached in memory and by browsers/CDN for 5 minutes.
 */

const {onRequest} = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

const CACHE_MS = 5 * 60 * 1000;
const CLUB_TIME_ZONE = "America/New_York";

let cached = null;
let cachedAt = 0;

/**
 * Year-month key ("2026-09") for a timestamp in the club's time zone.
 * @param {number} ms Epoch milliseconds.
 * @return {string} Month key.
 */
function monthKey(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CLUB_TIME_ZONE, year: "numeric", month: "2-digit",
  }).format(new Date(ms)).slice(0, 7);
}

/**
 * Reads games/ and users/ and computes the dashboard numbers.
 * @return {Promise<Object>} Stats payload.
 */
async function computeStats() {
  const db = admin.database();
  const [gamesSnap, usersSnap] = await Promise.all([
    db.ref("games").get(),
    db.ref("users").get(),
  ]);

  const thisMonth = monthKey(Date.now());
  const stats = {
    totalGames: 0,
    soloGames: 0,
    groupGames: 0,
    gamesThisMonth: 0,
    activeMembers: 0,
  };

  gamesSnap.forEach((child) => {
    const game = child.val() || {};
    stats.totalGames++;
    if (game.category === "group") stats.groupGames++;
    else stats.soloGames++;
    if (typeof game.timestamp === "number" &&
        monthKey(game.timestamp) === thisMonth) {
      stats.gamesThisMonth++;
    }
  });

  // Approved accounts only; pending sign-ups aren't members yet.
  usersSnap.forEach((child) => {
    if ((child.val() || {}).status === "approved") stats.activeMembers++;
  });

  return {...stats, updatedAt: Date.now()};
}

exports.getClubStats = onRequest({cors: true}, async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({error: "Method not allowed"});
    return;
  }

  try {
    if (!cached || Date.now() - cachedAt > CACHE_MS) {
      cached = await computeStats();
      cachedAt = Date.now();
    }
    res.set("Cache-Control", "public, max-age=300, s-maxage=300");
    res.status(200).json(cached);
  } catch (err) {
    logger.error("getClubStats failed", {message: err.message});
    res.status(500).json({error: "Stats are unavailable right now."});
  }
});
