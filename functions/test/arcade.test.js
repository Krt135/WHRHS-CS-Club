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
  createArcadeHandler,
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
};
const FILES = {
  "games/uid123/dice/index.html":
    {contentType: "text/html; charset=utf-8", size: 13, body: "<html></html>"},
  "games/uid123/dice/Build/g.wasm.br":
    {contentType: "application/wasm", contentEncoding: "br",
      size: GAME_BYTES.length, body: GAME_BYTES},
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
  const calls = {openFile: 0, getGame: 0};
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
  });
  return {handler, calls};
};

const request = async (handler, path, method = "GET") => {
  const res = new FakeResponse();
  const done = new Promise((resolve) => res.on("finish", resolve));
  await handler({method, path, query: {}}, res);
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
