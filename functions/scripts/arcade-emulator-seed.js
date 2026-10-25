/**
 * Seeds the LOCAL emulators for the Arcade lock manual tests
 * (see functions/test/arcade-manual-tests.md). Never touches production:
 * it refuses to run unless the emulator host variables point at 127.0.0.1.
 *
 * Creates:
 *   - games/arcade-test-game: a tiny "game" with index.html and a brotli
 *     file stored with Content-Encoding: br, like a Unity build
 *   - games/arcade-test-download (approved) and
 *     games/arcade-test-download-pending: Windows download games, each with
 *     a tiny zip at downloads/{author}/{id}/build.zip
 *   - exectest@example.com (role exec) and membertest@example.com
 *     (role member), password "emulator-pass-123"
 *
 * Run from the repo root while the emulators are running under a demo
 * project, which can't reach production services:
 *   firebase emulators:start --project demo-whrhs-cs-club
 *   node functions/scripts/arcade-emulator-seed.js
 */

process.env.FIREBASE_DATABASE_EMULATOR_HOST ||= "127.0.0.1:9000";
process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= "127.0.0.1:9199";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";

const zlib = require("zlib");
const admin = require("firebase-admin");

const PROJECT = process.env.ARCADE_EMULATOR_PROJECT || "demo-whrhs-cs-club";
const GAME_ID = "arcade-test-game";
const AUTHOR = "arcadeTestAuthor";
const PASSWORD = "emulator-pass-123";
// The functions emulator uses "{project}" as the database namespace and
// "{project}.appspot.com" as the bucket when the CLI isn't logged in, and the
// real names when it is, so seed both.
const NAMESPACES = [PROJECT, `${PROJECT}-default-rtdb`];
const BUCKETS = [`${PROJECT}.appspot.com`, `${PROJECT}.firebasestorage.app`];

if (!PROJECT.startsWith("demo-")) {
  throw new Error("Seed only demo-* projects (got " + PROJECT + ")");
}

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
// An empty zip archive (just the end-of-central-directory record).
const EMPTY_ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.alloc(18)]);
const DOWNLOADS = [
  {id: "arcade-test-download", status: "approved"},
  {id: "arcade-test-download-pending", status: "pending"},
];

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

  const generations = {};
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
    for (const d of DOWNLOADS) {
      const file = bucket.file(`downloads/${AUTHOR}/${d.id}/build.zip`);
      await file.save(EMPTY_ZIP, {metadata: {contentType: "application/zip"}});
      // Approval pins the object generation (see approveDownload). The
      // functions emulator's default bucket is the first one.
      if (name === BUCKETS[0]) {
        const [meta] = await file.getMetadata();
        generations[d.id] = String(meta.generation);
      }
    }
  }

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
    for (const d of DOWNLOADS) {
      await db.ref(`games/${d.id}`).set({
        id: d.id,
        title: `Download Test (${d.status})`,
        category: "people",
        engine: "godot",
        format: "download",
        type: "download",
        platform: "windows",
        status: d.status,
        ...(d.status === "approved" ?
          {buildGeneration: generations[d.id]} : {}),
        fileSize: EMPTY_ZIP.length,
        embedUrl: "",
        authorUid: AUTHOR,
        authorName: "Emulator",
        timestamp: Date.now(),
      });
    }
    for (const u of USERS) {
      await db.ref(`users/${u.uid}`).set({
        uid: u.uid, email: u.email, role: u.role, status: "approved",
        emailPreferences: {announcements: false, newGames: false},
      });
    }
    await db.ref("arcadeOverride").remove();
    await db.ref("arcadeOverrideAttempts").remove();
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

  console.log(`Seeded games "${GAME_ID}", ` +
    DOWNLOADS.map((d) => `"${d.id}"`).join(", ") + " and users " +
    USERS.map((u) => `${u.email} (${u.role})`).join(", "));
}

main().then(() => process.exit(0), (err) => {
  console.error(err);
  process.exit(1);
});
