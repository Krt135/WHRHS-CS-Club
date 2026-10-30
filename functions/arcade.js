/**
 * Arcade: serves uploaded games and Windows download builds.
 *
 * The Arcade is separated from the main site by subdomain at IT's request.
 * There is no school-hours lock.
 *
 * Game builds live in a private Storage folder (games/{uid}/{gameId}/) and are
 * only reachable through this function. Games are served from the Cloud
 * Functions domain, not the site's, so uploaded game code never runs on the
 * same origin as member logins.
 *
 * Windows download builds live in downloads/{uid}/{gameId}/build.zip, also
 * private. They are too large to stream through a function, so /download
 * answers with a short-lived signed URL.
 *
 * Routes on the `arcade` function:
 *   GET /status              - always {open: true, ...}; kept only so pages
 *                              cached from the lock era keep working
 *                              (also at /api/arcade/status via Hosting).
 *   GET /game/{gameId}/{path} - a file from the game's build. Files over
 *                              30 MiB are a 302 to a 5-minute signed URL
 *                              instead (see LARGE_FILE_BYTES).
 *   GET /download/{gameId}   - 302 to a 5-minute signed URL for an approved
 *                              download build, or 404. The stored object
 *                              must still be the generation an exec
 *                              approved (games/{id}/buildGeneration).
 *   GET /download/{gameId}?review=1 with "Authorization: Bearer <ID token>"
 *                            - exec/admin only: {url, generation} for a
 *                              build in any review status, so it can be
 *                              checked before approval.
 *
 * Callable `approveDownload` ({gameId, decision, generation}): exec/admin
 * approve or reject a download build. Approval pins the reviewed object
 * generation; the database rules let only this function approve.
 */

const {onRequest, onCall, HttpsError} = require("firebase-functions/https");
const {onValueDeleted} = require("firebase-functions/database");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

const ID_RE = /^[-\w]{1,128}$/;
const DOWNLOAD_URL_TTL_MS = 5 * 60 * 1000;
// Cloud Run caps a function's HTTP/1 response at 32 MiB (10 MB if streamed),
// so bigger game files (a Godot index.wasm can be ~40 MB) are fetched from
// Storage directly. Leaves headroom under the 32 MiB limit.
const LARGE_FILE_BYTES = 30 * 1024 * 1024;
const GAME_FILE_URL_TTL_MS = 5 * 60 * 1000;
// Never served from a WebGL build, even if an old upload contains one:
// executables, scripts and archives belong in a reviewed download build.
const BLOCKED_FILE_RE =
  /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|jar|dll|zip|7z|rar)(\.(br|gz))?$/i;

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
 * Content-Type for a game file. Browsers need application/wasm to compile
 * .wasm while it streams, and uploads don't always store it.
 * @param {string} filePath Path inside the game folder.
 * @param {string} storedType Content-Type stored with the object, if any.
 * @return {string} Content-Type to send.
 */
function gameContentType(filePath, storedType) {
  if (/\.wasm$/i.test(filePath)) return "application/wasm";
  if (/\.pck$/i.test(filePath)) return "application/octet-stream";
  return storedType || "application/octet-stream";
}

/**
 * Builds the request handler. Data access is injected so tests can run it
 * without Firebase.
 * @param {Object} deps getGame(id),
 *   openFile(storagePath) -> ?{metadata, createReadStream()},
 *   statDownload(storagePath) -> ?{generation, size} (null when missing),
 *   signDownload(storagePath, filename, ttlMs) -> url,
 *   signGameFile(storagePath, contentType, ttlMs) -> url,
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
   * GET /download/{gameId}.
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

    // TODO(remove next release): pages cached from the lock era poll this
    // and disable Play unless it says open. Delete this route and the
    // /api/arcade/status rewrite in firebase.json once they've aged out.
    if (path === "/status") {
      res.status(200).json({open: true, reason: "schedule",
        overrideUntil: null, serverTime: Date.now()});
      return;
    }

    const isDownload = path.startsWith("/download/");
    if (!path.startsWith("/game/") && !isDownload) {
      res.status(404).json({error: "Not found"});
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

      const storagePath =
          `games/${game.authorUid}/${parsed.gameId}/${parsed.filePath}`;
      const file = await deps.openFile(storagePath);
      if (!file) {
        res.status(404).json({error: "Not found"});
        return;
      }

      const meta = file.metadata;
      const contentType = gameContentType(parsed.filePath, meta.contentType);
      if (Number(meta.size) > LARGE_FILE_BYTES) {
        const url = await deps.signGameFile(storagePath, contentType,
            GAME_FILE_URL_TTL_MS);
        logger.info("Arcade large file redirected", {
          gameId: parsed.gameId, size: Number(meta.size),
        });
        res.redirect(302, url);
        return;
      }

      res.status(200);
      res.set("Content-Type", contentType);
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
      expires: Date.now() + ttlMs,
      responseDisposition: `attachment; filename="${filename}"`,
    });
    return url;
  },
  signGameFile: async (storagePath, contentType, ttlMs) => {
    const file = admin.storage().bucket().file(storagePath);
    // Same signing setup as signDownload. The game page fetches this URL
    // cross-origin, so the bucket needs CORS for the function's origin.
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + ttlMs,
      responseType: contentType,
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

exports.parseGamePath = parseGamePath;
exports.createArcadeHandler = createArcadeHandler;
exports.createDownloadReview = createDownloadReview;
exports.downloadFilename = downloadFilename;
exports.cleanUpGameFiles = cleanUpGameFiles;
