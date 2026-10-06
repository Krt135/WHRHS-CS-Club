/**
 * One-time backfill for stats/public (the triggers keep it current after).
 *
 * Usage, from functions/:
 *   node scripts/backfill-stats.js <service-account.json> [--dry-run]
 *
 * --dry-run prints the counts without writing them.
 */

const path = require("path");
const admin = require("firebase-admin");
const {computePublicStats, PUBLIC_STATS_PATH} = require("../stats");

const DATABASE_URL = "https://whrhs-cs-club-default-rtdb.firebaseio.com";

/**
 * Computes the counts and (unless --dry-run) writes them.
 * @return {Promise<void>}
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const keyPath = args.find((arg) => !arg.startsWith("--")) ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    console.error("Usage: node scripts/backfill-stats.js " +
      "<service-account.json> [--dry-run]");
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.cert(require(path.resolve(keyPath))),
    databaseURL: DATABASE_URL,
  });

  const db = admin.database();
  const stats = await computePublicStats(db);
  console.log(JSON.stringify(stats, null, 2));

  if (dryRun) {
    console.log("Dry run: nothing written.");
  } else {
    await db.ref(PUBLIC_STATS_PATH).set(stats);
    console.log(`Wrote ${PUBLIC_STATS_PATH}.`);
  }
  await admin.app().delete();
}

main().catch((err) => {
  console.error("Backfill failed:", err.message);
  process.exit(1);
});
