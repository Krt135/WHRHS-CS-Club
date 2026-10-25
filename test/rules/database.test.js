// Realtime Database rules for Arcade games and moderation.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { AUTHOR, EXEC, OTHER, USERS, dbAs, downloadGame, makeEnv, seedDatabase } from "./helpers.js";
import { restoredGameRecord } from "../../scriptFolder/arcade-games.js";
import { COVER_URL_PREFIX, isCoverUrl } from "../../scriptFolder/game-details.js";

let env;
before(async () => { env = await makeEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

// The author's soft delete, as projects.js deleteGame writes it.
function softDelete(game, overrides = {}) {
    return {
        "games/g1": null,
        "deleted_posts/g1": {
            ...game,
            ...overrides,
            _deletedFrom: "games",
            _originalId: "g1",
            _sourceLabel: "Arcade Project",
            _deletedAt: 2,
            _deletedBy: "Author",
            _deletedById: AUTHOR,
        },
    };
}

// ---------- M1: moderation copies ----------

test("author's moderation copy must match the live game", async () => {
    const game = downloadGame();
    await seedDatabase(env, { users: USERS, games: { g1: game } });
    const db = dbAs(env, AUTHOR);
    for (const overrides of [
        { status: "approved" },
        { format: "webgl" },
        { fileSize: 99 },
        { platform: "mac" },
        { buildGeneration: "123" },
    ]) {
        await assertFails(db.ref().update(softDelete(game, overrides)));
    }
    await assertSucceeds(db.ref().update(softDelete(game)));
});

test("restoring a download game always lands as pending", async () => {
    // A copy that says approved (edited, or from before the rule existed).
    const copy = downloadGame({ status: "approved", buildGeneration: "123", id: "g1" });
    await seedDatabase(env, { users: USERS });
    const db = dbAs(env, EXEC);
    await assertSucceeds(db.ref("games/g1").set(restoredGameRecord(copy)));
    const saved = (await db.ref("games/g1").get()).val();
    assert.equal(saved.status, "pending");
    assert.equal(saved.buildGeneration, undefined);
});

test("restoring a non-download game keeps the copy as is", () => {
    const copy = { title: "Web", format: "webgl", type: "game", authorUid: AUTHOR };
    assert.deepEqual(restoredGameRecord(copy), copy);
});

// ---------- M2: only the approveDownload function approves ----------

test("no client can approve a build or set its generation", async () => {
    await seedDatabase(env, { users: USERS, games: { g1: downloadGame() } });
    for (const uid of [EXEC, AUTHOR]) {
        const db = dbAs(env, uid);
        await assertFails(db.ref("games/g1/status").set("approved"));
        await assertFails(db.ref("games/g1").update({ buildGeneration: "1" }));
        await assertFails(db.ref("games/g2").set(downloadGame({ status: "approved" })));
    }
    // The author can't reject their own build either.
    await assertFails(dbAs(env, AUTHOR).ref("games/g1/status").set("rejected"));
    // Execs may still reject (or send back to pending) directly.
    await assertSucceeds(dbAs(env, EXEC).ref("games/g1/status").set("rejected"));
    await assertSucceeds(dbAs(env, EXEC).ref("games/g1/status").set("pending"));
    // New uploads start pending.
    await assertSucceeds(dbAs(env, AUTHOR).ref("games/g3").set(downloadGame()));
});

test("an approved record keeps its generation through exec edits", async () => {
    await seedDatabase(env, { users: USERS, games: {
        g1: downloadGame({ status: "approved", buildGeneration: "111" }) } });
    const db = dbAs(env, EXEC);
    await assertSucceeds(db.ref("games/g1").update({ title: "Renamed" }));
    await assertFails(db.ref("games/g1").update({ buildGeneration: "222" }));
});

// ---------- L3: approved downloads are read-only for their author ----------

test("author can't edit an approved download, only delete it", async () => {
    const approved = downloadGame({ status: "approved", buildGeneration: "111" });
    await seedDatabase(env, { users: USERS, games: { g1: approved, g2: downloadGame() } });
    const db = dbAs(env, AUTHOR);
    for (const change of [
        { title: "Something else" }, { engine: "unity" }, { platform: "windows" },
        { fileSize: 1 }, { format: "external", embedUrl: "https://example.com" },
    ]) {
        await assertFails(db.ref("games/g1").update(change));
    }
    await assertFails(db.ref("games/g1/title").set("Renamed"));
    await assertFails(db.ref("games/g1/title").remove());
    await assertFails(db.ref("games/g1").set({ ...approved, title: "Renamed" }));
    // Pending builds stay editable.
    await assertSucceeds(db.ref("games/g2").update({ title: "Renamed" }));
    // Soft delete still works.
    await assertSucceeds(db.ref().update(softDelete(approved)));
});

// ---------- Game details: description, credits, known bugs ----------

const webglGame = (fields = {}) => ({
    id: "w1", title: "Web Game", category: "people", engine: "unity",
    format: "webgl", type: "game", embedUrl: "", authorUid: AUTHOR,
    authorName: "Author", timestamp: 1, ...fields,
});

const DETAIL_LIMITS = { description: 1000, credits: 300, knownBugs: 1000 };

test("detail fields must be non-empty strings within their limits", async () => {
    await seedDatabase(env, { users: USERS });
    const db = dbAs(env, AUTHOR);
    for (const [key, max] of Object.entries(DETAIL_LIMITS)) {
        await assertSucceeds(db.ref(`games/ok-${key}`).set(webglGame({ [key]: "x".repeat(max) })));
        await assertFails(db.ref(`games/long-${key}`).set(webglGame({ [key]: "x".repeat(max + 1) })));
        await assertFails(db.ref(`games/empty-${key}`).set(webglGame({ [key]: "" })));
        await assertFails(db.ref(`games/num-${key}`).set(webglGame({ [key]: 42 })));
    }
    // Plain text is stored as-is; it's rendered with textContent.
    await assertSucceeds(db.ref("games/xss").set(webglGame({
        description: "<img src=x onerror=alert(1)>" })));
});

test("records without detail fields stay valid (Loaded Dice)", async () => {
    await seedDatabase(env, { users: USERS });
    await assertSucceeds(dbAs(env, AUTHOR).ref("games/w1").set(webglGame()));
});

test("non-owners can't write another member's details", async () => {
    await seedDatabase(env, { users: USERS, games: { w1: webglGame() } });
    const db = dbAs(env, OTHER);
    for (const key of Object.keys(DETAIL_LIMITS)) {
        await assertFails(db.ref(`games/w1/${key}`).set("hijacked"));
    }
    await assertFails(env.unauthenticatedContext().database()
        .ref("games/w1/description").set("anon"));
});

// ---------- Cover URL ----------

const coverUrl = (uid, gameId) =>
    `${COVER_URL_PREFIX}${uid}%2F${gameId}%2Fcover.webp?alt=media&token=abc`;

test("coverUrl must be this game's own cover download URL", async () => {
    await seedDatabase(env, { users: USERS });
    const db = dbAs(env, AUTHOR);
    const own = coverUrl(AUTHOR, "w1");
    assert.equal(isCoverUrl(own, AUTHOR, "w1"), true);
    await assertSucceeds(db.ref("games/w1").set(webglGame({ coverUrl: own })));
    for (const bad of [
        "https://evil.example/cover.webp",
        "https://firebasestorage.googleapis.com/v0/b/other-bucket/o/covers%2FauthorUid%2Fw2%2Fcover.webp?alt=media",
        coverUrl(OTHER, "w2"),          // another member's cover
        coverUrl(AUTHOR, "elsewhere"),  // another game's cover
        `${COVER_URL_PREFIX}${AUTHOR}%2Fw2%2Fcover.png?alt=media`,
        "javascript:alert(1)",
        `${own}${"x".repeat(2048)}`,
    ]) {
        assert.equal(isCoverUrl(bad, AUTHOR, "w2"), false, bad);
        await assertFails(db.ref("games/w2").set(webglGame({ id: "w2", coverUrl: bad })));
    }
});
