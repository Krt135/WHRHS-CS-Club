/**
 * Arcade function tests: `npm test` in functions/.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {PassThrough, Readable} = require("stream");
const {
  cleanUpGameFiles,
  createArcadeHandler,
  createDownloadReview,
  downloadFilename,
  parseGamePath,
} = require("../arcade");

// ---------- Paths ----------

test("game paths stay inside the game folder", () => {
  assert.deepEqual(parseGamePath("abc/Build/x.wasm.br"),
      {gameId: "abc", filePath: "Build/x.wasm.br"});
  assert.deepEqual(parseGamePath("abc"), {gameId: "abc", filePath: null});
  assert.deepEqual(parseGamePath("abc/"), {gameId: "abc", filePath: ""});
  assert.equal(parseGamePath("abc/../other/index.html"), null);
  assert.equal(parseGamePath("abc/%2e%2e/index.html"), null);
  assert.equal(parseGamePath("abc/a//b"), null);
  assert.equal(parseGamePath("abc/a%5Cb"), null);
  assert.equal(parseGamePath("abc/%E0%A4%A"), null);
  assert.equal(parseGamePath("a.b/index.html"), null);
});

// ---------- HTTP handler ----------

const GAME_BYTES = Buffer.from("SECRET-GAME-BYTES-wasm-payload");
const GAMES = {
  dice: {type: "game", authorUid: "uid123"},
  godot: {type: "game", authorUid: "uid123"},
  link: {type: "web", authorUid: "uid123", embedUrl: "https://x.github.io"},
  winOk: {format: "download", type: "download", status: "approved",
    title: "Loaded Dice: Deluxe!", authorUid: "uid123", buildGeneration: "111"},
  // Approved, but the stored object isn't the generation that was approved.
  winStale: {format: "download", status: "approved", authorUid: "uid123",
    buildGeneration: "999"},
  // Approved before approvals were pinned to a generation.
  winUnpinned: {format: "download", status: "approved", authorUid: "uid123"},
  winPending: {format: "download", type: "download", status: "pending",
    title: "Pending", authorUid: "uid123"},
  winRejected: {format: "download", type: "download", status: "rejected",
    title: "Rejected", authorUid: "uid123"},
  winMissing: {format: "download", status: "approved", authorUid: "uid123"},
  // A WebGL record with a forged status is still not a download.
  webglApproved: {type: "game", status: "approved", authorUid: "uid123"},
};
const ZIPS = {
  "downloads/uid123/winOk/build.zip": {generation: "111", size: 4096},
  "downloads/uid123/winStale/build.zip": {generation: "111", size: 4096},
  "downloads/uid123/winUnpinned/build.zip": {generation: "111", size: 4096},
  "downloads/uid123/winPending/build.zip": {generation: "222", size: 2048},
  "downloads/uid123/winRejected/build.zip": {generation: "333", size: 1024},
  "downloads/uid123/webglApproved/build.zip": {generation: "444", size: 1},
};
const TOKENS = {"exec-token": "execUid", "member-token": "memberUid"};
const ROLES = {execUid: "exec", memberUid: "member"};
const FILES = {
  "games/uid123/dice/index.html":
    {contentType: "text/html; charset=utf-8", size: 13, body: "<html></html>"},
  "games/uid123/dice/Build/g.wasm.br":
    {contentType: "application/wasm", contentEncoding: "br",
      size: GAME_BYTES.length, body: GAME_BYTES},
  // Shaped like Loaded Dice (Unity WebGL, Brotli).
  "games/uid123/dice/Build/Gambers-Revenge.data.br":
    {contentType: "application/octet-stream", contentEncoding: "br",
      size: 4, body: "data"},
  "games/uid123/dice/TemplateData/style.css":
    {contentType: "text/css; charset=utf-8", size: 4, body: "body"},
  // Uploaded before the storage rules allowed only web-build files.
  "games/uid123/dice/setup.exe":
    {contentType: "application/octet-stream", size: 2, body: "MZ"},
  "games/uid123/dice/Build/setup.exe.br":
    {contentType: "application/octet-stream", contentEncoding: "br",
      size: 2, body: "MZ"},
  // Shaped like a Godot 4 web export. Sizes are metadata only; the large
  // file must never be streamed, so its body is a marker.
  "games/uid123/godot/index.html":
    {contentType: "text/html", size: 13, body: "<html></html>"},
  "games/uid123/godot/index.wasm":
    {contentType: "application/octet-stream", size: 38.5 * 1024 * 1024,
      body: "BIG-WASM"},
  "games/uid123/godot/small.wasm":
    {contentType: "application/octet-stream", size: 4, body: "\0asm"},
  "games/uid123/godot/index.pck":
    {size: 4, body: "GDPC"},
  "games/uid123/godot/big.zip":
    {contentType: "application/zip", size: 40 * 1024 * 1024, body: "PK"},
};

/**
 * Minimal Express-like response that collects the body.
 */
class FakeResponse extends PassThrough {
  /** Sets up empty state. */
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
    this.headersSent = false;
    this.on("data", (c) => this.chunks.push(Buffer.from(c)));
  }
  /**
   * @param {number} code HTTP status.
   * @return {FakeResponse} this
   */
  status(code) {
    this.statusCode = code; return this;
  }
  /**
   * @param {string} k Header.
   * @param {string} v Value.
   * @return {FakeResponse} this
   */
  set(k, v) {
    this.headers[k.toLowerCase()] = v; return this;
  }
  /**
   * @param {string} t Short type.
   * @return {FakeResponse} this
   */
  type(t) {
    return this.set("Content-Type", t === "html" ? "text/html" : t);
  }
  /** @param {*} body Response body. */
  send(body) {
    this.headersSent = true; this.end(body);
  }
  /** @param {*} body JSON body. */
  json(body) {
    this.set("Content-Type", "application/json");
    this.send(JSON.stringify(body));
  }
  /**
   * @param {number} code Status.
   * @param {string} url Location.
   */
  redirect(code, url) {
    this.status(code).set("Location", url); this.send("");
  }
  /** @return {Buffer} Everything written. */
  get body() {
    return Buffer.concat(this.chunks);
  }
}

const makeHandler = () => {
  const calls = {openFile: 0, getGame: 0, sign: [], signGame: [],
    verify: 0};
  const handler = createArcadeHandler({
    getGame: async (id) => {
      calls.getGame++; return GAMES[id] || null;
    },
    openFile: async (path) => {
      calls.openFile++;
      const f = FILES[path];
      if (!f) return null;
      return {metadata: f, createReadStream: () => Readable.from([f.body])};
    },
    statDownload: async (path) => ZIPS[path] || null,
    signDownload: async (path, filename, ttlMs) => {
      calls.sign.push({path, filename, ttlMs});
      return `https://signed.example/${path}?ttl=${ttlMs}`;
    },
    signGameFile: async (path, contentType, ttlMs) => {
      calls.signGame.push({path, contentType, ttlMs});
      return `https://signed.example/${path}?type=${contentType}`;
    },
    verifyIdToken: async (token) => {
      calls.verify++;
      if (!TOKENS[token]) throw new Error("bad token");
      return {uid: TOKENS[token]};
    },
    getRole: async (uid) => ROLES[uid] || null,
  });
  return {handler, calls};
};

const request = async (handler, path, method = "GET", opts = {}) => {
  const res = new FakeResponse();
  const done = new Promise((resolve) => res.on("finish", resolve));
  const headers = opts.headers || {};
  await handler({method, path, query: opts.query || {},
    get: (name) => headers[name]}, res);
  res.resume();
  await done;
  return res;
};

test("status route always says open, on both paths, never cached",
    async () => {
      for (const path of ["/status", "/api/arcade/status"]) {
        const {handler, calls} = makeHandler();
        const res = await request(handler, path);
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers["cache-control"], "private, no-store");
        const body = JSON.parse(res.body);
        assert.equal(body.open, true);
        assert.equal(body.reason, "schedule");
        assert.equal(body.overrideUntil, null);
        assert.equal(calls.getGame, 0);
      }
    });

test(".br files stream with Content-Encoding br", async () => {
  const {handler} = makeHandler();
  const res = await request(handler, "/game/dice/Build/g.wasm.br");
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/wasm");
  assert.equal(res.headers["content-encoding"], "br");
  assert.equal(res.headers["content-length"], String(GAME_BYTES.length));
  assert.equal(res.headers["cache-control"], "private, no-store");
  assert.deepEqual(res.body, GAME_BYTES);
});

test("bad paths, unknown games and external links are 404", async () => {
  for (const path of ["/game/dice/missing.js", "/game/nope/index.html",
    "/game/link/index.html", "/game/dice/../x", "/other"]) {
    const {handler} = makeHandler();
    const res = await request(handler, path);
    assert.equal(res.statusCode, 404, path);
  }
});

test("folder URLs redirect so relative assets resolve", async () => {
  const {handler} = makeHandler();
  assert.equal((await request(handler, "/game/dice")).headers.location,
      "dice/index.html");
  assert.equal((await request(handler, "/game/dice/")).headers.location,
      "index.html");
});

// ---------- Windows downloads ----------

const reviewAs = (token) => ({query: {review: "1"},
  headers: token ? {Authorization: `Bearer ${token}`} : {}});

test("approved download redirects to a 5-minute attachment URL", async () => {
  const {handler, calls} = makeHandler();
  const res = await request(handler, "/download/winOk");
  assert.equal(res.statusCode, 302);
  assert.ok(res.headers.location.startsWith(
      "https://signed.example/downloads/uid123/winOk/build.zip"));
  assert.equal(res.headers["cache-control"], "private, no-store");
  assert.deepEqual(calls.sign, [{
    path: "downloads/uid123/winOk/build.zip",
    filename: "Loaded-Dice-Deluxe-windows.zip",
    ttlMs: 5 * 60 * 1000,
  }]);
});

test("pending, rejected, missing and non-download games are 404", async () => {
  for (const id of ["winPending", "winRejected", "winMissing", "nope",
    "dice", "link", "webglApproved", "bad%2Fid", ""]) {
    const {handler, calls} = makeHandler();
    const res = await request(handler, `/download/${id}`);
    assert.equal(res.statusCode, 404, id);
    assert.equal(res.headers.location, undefined, id);
    assert.equal(calls.sign.length, 0, id);
  }
});

test("approved downloads must still be the approved generation", async () => {
  for (const id of ["winStale", "winUnpinned"]) {
    const {handler, calls} = makeHandler();
    const res = await request(handler, `/download/${id}`);
    assert.equal(res.statusCode, 404, id);
    assert.equal(calls.sign.length, 0, id);
  }
});

test("exec review returns JSON for pending builds", async () => {
  for (const id of ["winPending", "winOk", "winRejected", "winStale"]) {
    const {handler} = makeHandler();
    const res = await request(handler, `/download/${id}`, "GET",
        reviewAs("exec-token"));
    assert.equal(res.statusCode, 200, id);
    const body = JSON.parse(res.body);
    assert.ok(body.url.startsWith(
        `https://signed.example/downloads/uid123/${id}/build.zip`));
    assert.equal(body.generation,
        ZIPS[`downloads/uid123/${id}/build.zip`].generation);
  }
});

test("review needs a valid token from an exec or admin", async () => {
  const cases = [[null, 401], ["garbage", 401], ["member-token", 403]];
  for (const [token, code] of cases) {
    const {handler, calls} = makeHandler();
    const res = await request(handler, "/download/winPending", "GET",
        reviewAs(token));
    assert.equal(res.statusCode, code, String(token));
    assert.ok(!res.body.toString().includes("signed.example"));
    assert.equal(calls.sign.length, 0);
  }
  // Review still 404s for things that aren't download builds.
  const {handler} = makeHandler();
  const res = await request(handler, "/download/dice", "GET",
      reviewAs("exec-token"));
  assert.equal(res.statusCode, 404);
});

test("download file names are sanitized", () => {
  assert.equal(downloadFilename("Loaded Dice"), "Loaded-Dice-windows.zip");
  assert.equal(downloadFilename("a\"b\r\nc/../d"), "a-b-c-..-d-windows.zip");
  assert.equal(downloadFilename(""), "game-windows.zip");
  assert.equal(downloadFilename("???"), "game-windows.zip");
  assert.equal(downloadFilename("x".repeat(200)).length,
      60 + "-windows.zip".length);
});

const cleanupDeps = (exists) => {
  const deleted = [];
  return {
    deleted,
    deps: {
      gameExists: async () => exists,
      deleteFile: async (p) => deleted.push(p),
      deletePrefix: async (p) => deleted.push(`${p}*`),
    },
  };
};

test("permanent delete removes the build and cover; restore does not",
    async () => {
      const post = {_deletedFrom: "games", _originalId: "winOk",
        format: "download", authorUid: "uid123"};
      const gone = cleanupDeps(false);
      assert.deepEqual(await cleanUpGameFiles(post, "winOk", gone.deps), [
        "covers/uid123/winOk/", "downloads/uid123/winOk/build.zip"]);
      assert.deepEqual(gone.deleted, [
        "covers/uid123/winOk/*", "downloads/uid123/winOk/build.zip"]);

      // Restore writes games/{id} back first, so the files stay.
      const restored = cleanupDeps(true);
      assert.deepEqual(await cleanUpGameFiles(post, "winOk", restored.deps),
          []);
      assert.deepEqual(restored.deleted, []);
    });

test("permanent delete of a WebGL or link game removes only its cover",
    async () => {
      for (const format of ["webgl", "external", undefined]) {
        const post = {_deletedFrom: "games", _originalId: "dice", format,
          authorUid: "uid123"};
        const {deps, deleted} = cleanupDeps(false);
        assert.deepEqual(await cleanUpGameFiles(post, "dice", deps),
            ["covers/uid123/dice/"], String(format));
        assert.deepEqual(deleted, ["covers/uid123/dice/*"], String(format));
      }
    });

test("cleanup ignores other records and bad ids", async () => {
  const post = {_deletedFrom: "games", _originalId: "winOk",
    format: "download", authorUid: "uid123"};
  const {deps, deleted} = cleanupDeps(false);
  assert.deepEqual(await cleanUpGameFiles({...post, _deletedFrom: "lessons"},
      "winOk", deps), []);
  assert.deepEqual(await cleanUpGameFiles({...post, authorUid: "../x"},
      "winOk", deps), []);
  assert.deepEqual(await cleanUpGameFiles(null, "winOk", deps), []);
  assert.deepEqual(deleted, []);
});

test("cleanup skips records not stored under their own game id", async () => {
  const {deps, deleted} = cleanupDeps(false);
  // e.g. an exec-written deleted_posts/someKey pointing at another game.
  const post = {_deletedFrom: "games", _originalId: "victimGame",
    format: "download", authorUid: "victimUid"};
  assert.deepEqual(await cleanUpGameFiles(post, "someKey", deps), []);
  assert.deepEqual(await cleanUpGameFiles({...post, _originalId: undefined},
      "victimGame", deps), []);
  // The paths always come from the record's own authorUid and id.
  const build = "downloads/victimUid/victimGame/build.zip";
  assert.deepEqual(await cleanUpGameFiles(post, "victimGame", deps),
      ["covers/victimUid/victimGame/", build]);
  assert.deepEqual(deleted, ["covers/victimUid/victimGame/*", build]);
});

// ---------- Download review callable ----------

const makeReview = (games = GAMES, zips = ZIPS) => {
  const saved = [];
  const live = structuredClone(games);
  const review = createDownloadReview({
    verifyIdToken: async (token) => {
      if (token === "revoked-token") throw new Error("auth/id-token-revoked");
      if (!TOKENS[token]) throw new Error("bad token");
      return {uid: TOKENS[token]};
    },
    getRole: async (uid) => ROLES[uid] || null,
    getGame: async (id) => live[id] || null,
    statDownload: async (path) => zips[path] || null,
    saveReview: async (gameId, fields) => {
      saved.push({gameId, fields});
      for (const [k, v] of Object.entries(fields)) {
        if (v === null) delete live[gameId][k];
        else live[gameId][k] = v;
      }
    },
  });
  return {review, saved, live};
};

const callAs = (token, data) => ({
  auth: token ? {uid: TOKENS[token] || "someone"} : null,
  rawRequest: {get: (name) =>
    name === "Authorization" && token ? `Bearer ${token}` : undefined},
  data,
});

const rejectsWith = async (promise, code) => {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code);
    return true;
  });
};

test("approving needs an exec or admin with a live token", async () => {
  const {review, saved} = makeReview();
  const data = {gameId: "winPending", decision: "approved", generation: "222"};
  await rejectsWith(review(callAs(null, data)), "unauthenticated");
  await rejectsWith(review(callAs("revoked-token", data)), "unauthenticated");
  await rejectsWith(review(callAs("member-token", data)), "permission-denied");
  assert.deepEqual(saved, []);
});

test("approving with no uploaded build fails", async () => {
  const {review, saved} = makeReview();
  await rejectsWith(review(callAs("exec-token", {gameId: "winMissing",
    decision: "approved", generation: "1"})), "failed-precondition");
  assert.deepEqual(saved, []);
});

test("approving pins the reviewed generation and real size", async () => {
  const {review, saved, live} = makeReview();
  // Not the generation the exec downloaded.
  await rejectsWith(review(callAs("exec-token", {gameId: "winPending",
    decision: "approved", generation: "221"})), "failed-precondition");
  await rejectsWith(review(callAs("exec-token", {gameId: "winPending",
    decision: "approved"})), "failed-precondition");
  assert.deepEqual(saved, []);

  assert.deepEqual(await review(callAs("exec-token", {gameId: "winPending",
    decision: "approved", generation: "222"})), {status: "approved"});
  assert.deepEqual(saved, [{gameId: "winPending", fields: {
    status: "approved", buildGeneration: "222", fileSize: 2048}}]);

  // The approved record now signs; the same record with another object
  // generation does not.
  const handler = (zips) => createArcadeHandler({
    getGame: async (id) => live[id] || null,
    openFile: async () => null,
    statDownload: async (path) => zips[path] || null,
    signDownload: async (path) => `https://signed.example/${path}`,
    verifyIdToken: async () => ({uid: "x"}),
    getRole: async () => null,
  });
  const ok = await request(handler(ZIPS), "/download/winPending");
  assert.equal(ok.statusCode, 302);
  const swapped = {...ZIPS,
    "downloads/uid123/winPending/build.zip": {generation: "223", size: 9}};
  assert.equal((await request(handler(swapped), "/download/winPending"))
      .statusCode, 404);
});

test("rejecting works without a build and clears the generation", async () => {
  const {review, saved} = makeReview();
  assert.deepEqual(await review(callAs("exec-token", {gameId: "winMissing",
    decision: "rejected"})), {status: "rejected"});
  assert.deepEqual(await review(callAs("exec-token", {gameId: "winOk",
    decision: "rejected"})), {status: "rejected"});
  assert.deepEqual(saved.map((s) => s.fields), [
    {status: "rejected", buildGeneration: null},
    {status: "rejected", buildGeneration: null},
  ]);
});

test("review only accepts download games and known decisions", async () => {
  const {review, saved} = makeReview();
  for (const [data, code] of [
    [{gameId: "dice", decision: "approved", generation: "1"}, "not-found"],
    [{gameId: "nope", decision: "rejected"}, "not-found"],
    [{gameId: "winPending", decision: "pending"}, "invalid-argument"],
    [{gameId: "../x", decision: "rejected"}, "invalid-argument"],
    [{decision: "rejected"}, "invalid-argument"],
  ]) {
    await rejectsWith(review(callAs("exec-token", data)), code);
  }
  assert.deepEqual(saved, []);
});

// ---------- WebGL file types ----------

test("executables and archives in a WebGL build are never served", async () => {
  for (const file of ["setup.exe", "Build/setup.exe.br", "SETUP.EXE",
    "x.msi", "run.bat", "a.cmd", "a.com", "a.scr", "a.ps1", "a.vbs",
    "a.jar", "a.dll", "a.zip", "a.7z", "a.rar", "a.zip.gz"]) {
    const {handler, calls} = makeHandler();
    const res = await request(handler, `/game/dice/${file}`);
    assert.equal(res.statusCode, 404, file);
    assert.ok(!res.body.toString().includes("MZ"), file);
    assert.equal(calls.openFile, 0, file);
    assert.equal(calls.getGame, 0, file);
  }
});

test("web build files still serve, with nosniff", async () => {
  for (const file of ["Build/g.wasm.br", "Build/Gambers-Revenge.data.br",
    "TemplateData/style.css", "index.html"]) {
    const {handler} = makeHandler();
    const res = await request(handler, `/game/dice/${file}`);
    assert.equal(res.statusCode, 200, file);
    assert.equal(res.headers["x-content-type-options"], "nosniff", file);
  }
});

// ---------- Large files (Godot) ----------

test("files over 30 MiB redirect to a 5-minute signed URL", async () => {
  for (const method of ["GET", "HEAD"]) {
    const {handler, calls} = makeHandler();
    const res = await request(handler, "/game/godot/index.wasm", method);
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location,
        "https://signed.example/games/uid123/godot/index.wasm" +
        "?type=application/wasm");
    assert.equal(res.headers["cache-control"], "private, no-store");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["content-length"], undefined);
    assert.ok(!res.body.toString().includes("BIG-WASM"));
    assert.deepEqual(calls.signGame, [{path: "games/uid123/godot/index.wasm",
      contentType: "application/wasm", ttlMs: 5 * 60 * 1000}]);
  }
});

test("large blocked files are still 404 and never signed", async () => {
  const {handler, calls} = makeHandler();
  const res = await request(handler, "/game/godot/big.zip");
  assert.equal(res.statusCode, 404);
  assert.equal(calls.openFile, 0);
  assert.deepEqual(calls.signGame, []);
});

test(".wasm is application/wasm and .pck is octet-stream", async () => {
  const {handler, calls} = makeHandler();
  const wasm = await request(handler, "/game/godot/small.wasm");
  assert.equal(wasm.statusCode, 200);
  assert.equal(wasm.headers["content-type"], "application/wasm");
  assert.equal(wasm.headers["content-length"], "4");
  assert.equal(wasm.body.toString(), "\0asm");
  const pck = await request(handler, "/game/godot/index.pck");
  assert.equal(pck.statusCode, 200);
  assert.equal(pck.headers["content-type"], "application/octet-stream");
  assert.equal(pck.body.toString(), "GDPC");
  assert.deepEqual(calls.signGame, []);
});

test("Loaded Dice .br files are served exactly as before", async () => {
  const {handler, calls} = makeHandler();
  const data = await request(handler,
      "/game/dice/Build/Gambers-Revenge.data.br");
  assert.equal(data.statusCode, 200);
  assert.equal(data.headers["content-type"], "application/octet-stream");
  assert.equal(data.headers["content-encoding"], "br");
  assert.equal(data.headers["content-length"], "4");
  assert.equal(data.body.toString(), "data");
  const wasm = await request(handler, "/game/dice/Build/g.wasm.br");
  assert.equal(wasm.headers["content-type"], "application/wasm");
  assert.equal(wasm.headers["content-encoding"], "br");
  assert.deepEqual(calls.signGame, []);
});
