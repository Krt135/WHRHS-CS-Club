/**
 * Seeds the LOCAL emulators for the Arcade lock manual tests
 * (see functions/test/arcade-manual-tests.md). Never touches production:
 * it refuses to run unless the emulator host variables point at 127.0.0.1.
 *
 * Creates:
 *   - games/arcade-test-game: a tiny "game" with index.html and a brotli
 *     file stored with Content-Encoding: br, like a Unity build
 *   - exectest@example.com (role exec) and membertest@example.com
 *     (role member), password "emulator-pass-123"
 *
 * Run from the repo root while `firebase emulators:start` is running:
 *   node functions/scripts/arcade-emulator-seed.js
 */

process.env.FIREBASE_DATABASE_EMULATOR_HOST ||= "127.0.0.1:9000";
process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= "127.0.0.1:9199";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";

const zlib = require("zlib");
const admin = require("firebase-admin");

const PROJECT = "whrhs-cs-club";
const GAME_ID = "arcade-test-game";
const AUTHOR = "arcadeTestAuthor";
const PASSWORD = "emulator-pass-123";
// The functions emulator uses "{project}" as the database namespace and
// "{project}.appspot.com" as the bucket when the CLI isn't logged in, and the
// real names when it is, so seed both.
const NAMESPACES = [PROJECT, `${PROJECT}-default-rtdb`];
const BUCKETS = [`${PROJECT}.appspot.com`, `${PROJECT}.firebasestorage.app`];

for (const key of ["FIREBASE_DATABASE_EMULATOR_HOST",
  "FIREBASE_STORAGE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"]) {
  if (!process.env[key].startsWith("127.0.0.1:") &&
      !process.env[key].startsWith("localhost:")) {
    throw new Error(`${key} must point at a local emulator`);
  }
}

const INDEX_HTML = `<!DOCTYPE html><html><head><title>Arcade test</title>
<script src="Build/game.js.br"></script></head>
<body><p id="msg">ARCADE-TEST-GAME-CONTENT</p></body></html>`;
const GAME_JS = "document.title = 'ARCADE-TEST-GAME-SCRIPT loaded';";

const USERS = [
  {uid: "execTestUser", email: "exectest@example.com", role: "exec"},
  {uid: "memberTestUser", email: "membertest@example.com", role: "member"},
];

/**
 * Seeds every emulator.
 * @return {Promise<void>}
 */
async function main() {
  const app = admin.initializeApp({projectId: PROJECT});

  for (const ns of NAMESPACES) {
    const db = app.database(`http://127.0.0.1:9000?ns=${ns}`);
    // Mark welcome emails as sent first so onUserSignup doesn't try to email
    // the test accounts.
    for (const u of USERS) {
      await db.ref(`welcomeEmailsSent/${u.uid}`).set({at: Date.now()});
    }
    await db.ref(`games/${GAME_ID}`).set({
      id: GAME_ID,
      title: "Arcade Test Game",
      category: "people",
      engine: "JSCanvas",
      type: "game",
      embedUrl: "",
      authorUid: AUTHOR,
      authorName: "Emulator",
      timestamp: Date.now(),
    });
    for (const u of USERS) {
      await db.ref(`users/${u.uid}`).set({
        uid: u.uid, email: u.email, role: u.role, status: "approved",
        emailPreferences: {announcements: false, newGames: false},
      });
    }
    await db.ref("arcadeOverride").remove();
    await db.ref("arcadeOverrideAttempts").remove();
  }

  for (const name of BUCKETS) {
    const folder = `games/${AUTHOR}/${GAME_ID}`;
    const bucket = app.storage().bucket(name);
    await bucket.file(`${folder}/index.html`).save(INDEX_HTML, {
      metadata: {contentType: "text/html; charset=utf-8"},
    });
    await bucket.file(`${folder}/Build/game.js.br`)
        .save(zlib.brotliCompressSync(GAME_JS), {
          metadata: {
            contentType: "application/javascript; charset=utf-8",
            contentEncoding: "br",
          },
        });
  }

  for (const u of USERS) {
    try {
      await app.auth().createUser({
        uid: u.uid, email: u.email, password: PASSWORD,
      });
    } catch (err) {
      if (err.code !== "auth/uid-already-exists") throw err;
    }
  }

  console.log(`Seeded game "${GAME_ID}" and users ` +
    USERS.map((u) => `${u.email} (${u.role})`).join(", "));
}

main().then(() => process.exit(0), (err) => {
  console.error(err);
  process.exit(1);
});
