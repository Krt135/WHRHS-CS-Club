// Realtime Database rules for Arcade games and moderation.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { AUTHOR, EXEC, USERS, dbAs, downloadGame, makeEnv, seedDatabase } from "./helpers.js";
import { restoredGameRecord } from "../../scriptFolder/arcade-games.js";

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
