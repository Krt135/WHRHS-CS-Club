/**
 * Arcade lock tests: `npm test` in functions/.
 * Times are written with their New York UTC offset (-04:00 EDT, -05:00 EST).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const {PassThrough, Readable} = require("stream");
const {
  LOCK_MESSAGE,
  arcadeStatus,
  codeMatches,
  cleanUpDownload,
  createArcadeHandler,
  createDownloadReview,
  downloadFilename,
  isSchoolHours,
  nextClubMidnight,
  parseGamePath,
} = require("../arcade");

const at = (iso) => Date.parse(iso);

// ---------- Schedule ----------

test("weekday boundaries (Wednesday, EDT)", () => {
  assert.equal(isSchoolHours(at("2026-10-14T07:29:59-04:00")), false);
  assert.equal(isSchoolHours(at("2026-10-14T07:30:00-04:00")), true);
  assert.equal(isSchoolHours(at("2026-10-14T14:14:59-04:00")), true);
  assert.equal(isSchoolHours(at("2026-10-14T14:15:00-04:00")), false);
  assert.equal(isSchoolHours(at("2026-10-14T00:00:00-04:00")), false);
  assert.equal(isSchoolHours(at("2026-10-14T23:59:00-04:00")), false);
});

test("weekday boundaries in winter (EST)", () => {
  assert.equal(isSchoolHours(at("2026-01-14T07:29:00-05:00")), false);
  assert.equal(isSchoolHours(at("2026-01-14T07:30:00-05:00")), true);
  assert.equal(isSchoolHours(at("2026-01-14T14:14:00-05:00")), true);
  assert.equal(isSchoolHours(at("2026-01-14T14:15:00-05:00")), false);
});

test("every weekday locks, weekends never do", () => {
  // Mon 12 Oct 2026 .. Sun 18 Oct 2026 at 10:00 AM.
  const expected = [true, true, true, true, true, false, false];
  expected.forEach((locked, i) => {
    const day = String(12 + i).padStart(2, "0");
    assert.equal(isSchoolHours(at(`2026-10-${day}T10:00:00-04:00`)), locked,
        `Oct ${day}`);
  });
  assert.equal(isSchoolHours(at("2026-10-17T07:30:00-04:00")), false);
  assert.equal(isSchoolHours(at("2026-10-18T14:14:00-04:00")), false);
});

test("uses New York time, not the server's UTC clock", () => {
  // 11:45 UTC Wednesday = 7:45 AM in New York.
  assert.equal(isSchoolHours(at("2026-10-14T11:45:00Z")), true);
  // 18:20 UTC = 2:20 PM in New York.
  assert.equal(isSchoolHours(at("2026-10-14T18:20:00Z")), false);
});

// ---------- Override expiry ----------

test("override expires at the next New York midnight", () => {
  const setAt = at("2026-10-14T13:00:00-04:00");
  const expiresAt = nextClubMidnight(setAt);
  assert.equal(expiresAt, at("2026-10-15T00:00:00-04:00"));

  assert.deepEqual(arcadeStatus(setAt, expiresAt),
      {open: true, reason: "override", overrideUntil: expiresAt});
  assert.equal(arcadeStatus(expiresAt - 1000, expiresAt).reason, "override");
  // At midnight the override is gone; the schedule says open (it's 12 AM).
  assert.deepEqual(arcadeStatus(expiresAt, expiresAt),
      {open: true, reason: "schedule", overrideUntil: null});
  // Next morning it locks again.
  assert.equal(
      arcadeStatus(at("2026-10-15T07:30:00-04:00"), expiresAt).open, false);
});

test("override set seconds before midnight still ends at that midnight", () => {
  assert.equal(nextClubMidnight(at("2026-10-14T23:59:59-04:00")),
      at("2026-10-15T00:00:00-04:00"));
  assert.equal(nextClubMidnight(at("2026-10-15T00:00:00-04:00")),
      at("2026-10-16T00:00:00-04:00"));
});

test("midnight is correct across DST changes", () => {
  // Fall back: Sun 1 Nov 2026 is 25 hours long.
  assert.equal(nextClubMidnight(at("2026-10-31T23:00:00-04:00")),
      at("2026-11-01T00:00:00-04:00"));
  assert.equal(nextClubMidnight(at("2026-11-01T10:00:00-05:00")),
      at("2026-11-02T00:00:00-05:00"));
  // Spring forward: Sun 8 Mar 2026 is 23 hours long.
  assert.equal(nextClubMidnight(at("2026-03-08T01:00:00-05:00")),
      at("2026-03-09T00:00:00-04:00"));
});

test("an override during school hours unlocks, a stale one does not", () => {
  const now = at("2026-10-14T09:00:00-04:00");
  assert.equal(arcadeStatus(now, null).open, false);
  assert.equal(arcadeStatus(now, nextClubMidnight(now)).open, true);
  assert.equal(arcadeStatus(now, at("2026-10-14T00:00:00-04:00")).open, false);
  assert.equal(arcadeStatus(now, "9999999999999").open, false);
});

// ---------- Code check ----------

test("override code is checked against its SHA-256 hash", () => {
  const hash = crypto.createHash("sha256").update("purple-otter-lamp", "utf8")
      .digest("hex");
  assert.equal(codeMatches("purple-otter-lamp", hash), true);
  assert.equal(codeMatches("purple-otter-lamp", ` ${hash.toUpperCase()}\n`),
      true);
  assert.equal(codeMatches("purple-otter-lam", hash), false);
  assert.equal(codeMatches("purple-otter-lamp", ""), false);
  assert.equal(codeMatches("purple-otter-lamp", "not-a-hash"), false);
});

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

const makeHandler = (nowIso, overrideUntil = null) => {
  const calls = {openFile: 0, getGame: 0, sign: [], verify: 0};
  const handler = createArcadeHandler({
    now: () => at(nowIso),
    getOverrideUntil: async () => overrideUntil,
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

const OPEN = "2026-10-14T15:00:00-04:00";
const LOCKED = "2026-10-14T09:00:00-04:00";

test("status route answers on both paths and is never cached", async () => {
  for (const path of ["/status", "/api/arcade/status"]) {
    const {handler} = makeHandler(LOCKED);
    const res = await request(handler, path);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["cache-control"], "private, no-store");
    const body = JSON.parse(res.body);
    assert.equal(body.open, false);
    assert.equal(body.reason, "school-hours");
  }
});

test("locked game URLs return 423 and none of the game", async () => {
  for (const path of ["/game/dice/index.html", "/game/dice/Build/g.wasm.br"]) {
    for (const method of ["GET", "HEAD"]) {
      const {handler, calls} = makeHandler(LOCKED);
      const res = await request(handler, path, method);
      assert.equal(res.statusCode, 423);
      assert.equal(res.headers["cache-control"], "private, no-store");
      assert.equal(res.headers["content-encoding"], undefined);
      assert.ok(res.body.toString().includes(LOCK_MESSAGE));
      assert.ok(!res.body.includes(GAME_BYTES));
      assert.equal(calls.getGame, 0, "game record must not be read");
      assert.equal(calls.openFile, 0, "game file must not be opened");
    }
  }
});

test("open: .br files stream with Content-Encoding br", async () => {
  const {handler} = makeHandler(OPEN);
  const res = await request(handler, "/game/dice/Build/g.wasm.br");
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/wasm");
  assert.equal(res.headers["content-encoding"], "br");
  assert.equal(res.headers["content-length"], String(GAME_BYTES.length));
  assert.equal(res.headers["cache-control"], "private, no-store");
  assert.deepEqual(res.body, GAME_BYTES);
});

test("override unlocks game files during school hours", async () => {
  const until = nextClubMidnight(at(LOCKED));
  const {handler} = makeHandler(LOCKED, until);
  const res = await request(handler, "/game/dice/index.html");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.toString(), "<html></html>");
});

test("bad paths, unknown games and external links are 404", async () => {
  for (const path of ["/game/dice/missing.js", "/game/nope/index.html",
    "/game/link/index.html", "/game/dice/../x", "/other"]) {
    const {handler} = makeHandler(OPEN);
    const res = await request(handler, path);
    assert.equal(res.statusCode, 404, path);
  }
});

test("folder URLs redirect so relative assets resolve", async () => {
  const {handler} = makeHandler(OPEN);
  assert.equal((await request(handler, "/game/dice")).headers.location,
      "dice/index.html");
  assert.equal((await request(handler, "/game/dice/")).headers.location,
      "index.html");
});

test("status failure locks instead of serving", async () => {
  const handler = createArcadeHandler({
    now: () => at(OPEN),
    getOverrideUntil: async () => {
      throw new Error("db down");
    },
    getGame: async () => GAMES.dice,
    openFile: async () => {
      throw new Error("should not be called");
    },
  });
  const res = await request(handler, "/game/dice/index.html");
  assert.equal(res.statusCode, 500);
  assert.ok(!res.body.includes(GAME_BYTES));
});

// ---------- Windows downloads ----------

const reviewAs = (token) => ({query: {review: "1"},
  headers: token ? {Authorization: `Bearer ${token}`} : {}});

test("locked downloads return 423, no URL and no lookups", async () => {
  for (const opts of [{}, reviewAs("exec-token")]) {
    for (const method of ["GET", "HEAD"]) {
      const {handler, calls} = makeHandler(LOCKED);
      const res = await request(handler, "/download/winOk", method, opts);
      assert.equal(res.statusCode, 423);
      assert.equal(res.headers.location, undefined);
      assert.ok(res.body.toString().includes(LOCK_MESSAGE));
      assert.ok(!res.body.toString().includes("downloads/"));
      assert.equal(calls.getGame, 0);
      assert.equal(calls.sign.length, 0);
      assert.equal(calls.verify, 0);
    }
  }
});

test("approved download redirects to a 5-minute attachment URL", async () => {
  const {handler, calls} = makeHandler(OPEN);
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

test("override unlocks downloads during school hours", async () => {
  const {handler} = makeHandler(LOCKED, nextClubMidnight(at(LOCKED)));
  assert.equal((await request(handler, "/download/winOk")).statusCode, 302);
});

test("pending, rejected, missing and non-download games are 404", async () => {
  for (const id of ["winPending", "winRejected", "winMissing", "nope",
    "dice", "link", "webglApproved", "bad%2Fid", ""]) {
    const {handler, calls} = makeHandler(OPEN);
    const res = await request(handler, `/download/${id}`);
    assert.equal(res.statusCode, 404, id);
    assert.equal(res.headers.location, undefined, id);
    assert.equal(calls.sign.length, 0, id);
  }
});

test("approved downloads must still be the approved generation", async () => {
  for (const id of ["winStale", "winUnpinned"]) {
    const {handler, calls} = makeHandler(OPEN);
    const res = await request(handler, `/download/${id}`);
    assert.equal(res.statusCode, 404, id);
    assert.equal(calls.sign.length, 0, id);
  }
});

test("exec review returns JSON for pending builds", async () => {
  for (const id of ["winPending", "winOk", "winRejected", "winStale"]) {
    const {handler} = makeHandler(OPEN);
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
    const {handler, calls} = makeHandler(OPEN);
    const res = await request(handler, "/download/winPending", "GET",
        reviewAs(token));
    assert.equal(res.statusCode, code, String(token));
    assert.ok(!res.body.toString().includes("signed.example"));
    assert.equal(calls.sign.length, 0);
  }
  // Review still 404s for things that aren't download builds.
  const {handler} = makeHandler(OPEN);
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

test("permanent delete removes the build; restore does not", async () => {
  const post = {_deletedFrom: "games", _originalId: "winOk",
    format: "download", authorUid: "uid123"};
  const deleted = [];
  const deps = (exists) => ({
    gameExists: async () => exists,
    deleteFile: async (p) => deleted.push(p),
  });
  assert.equal(await cleanUpDownload(post, deps(false)),
      "downloads/uid123/winOk/build.zip");
  assert.equal(await cleanUpDownload(post, deps(true)), null);
  assert.equal(await cleanUpDownload({...post, format: "webgl"},
      deps(false)), null);
  assert.equal(await cleanUpDownload({...post, _deletedFrom: "lessons"},
      deps(false)), null);
  assert.equal(await cleanUpDownload({...post, authorUid: "../x"},
      deps(false)), null);
  assert.deepEqual(deleted, ["downloads/uid123/winOk/build.zip"]);
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
    now: () => at(OPEN),
    getOverrideUntil: async () => null,
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
    const {handler, calls} = makeHandler(OPEN);
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
    const {handler} = makeHandler(OPEN);
    const res = await request(handler, `/game/dice/${file}`);
    assert.equal(res.statusCode, 200, file);
    assert.equal(res.headers["x-content-type-options"], "nosniff", file);
  }
});
