// Shared setup for the security rules tests. Run them with
// `npm run test:rules`, which starts only the Database and Storage emulators
// under the demo project (see AGENTS.md).

import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";

export const PROJECT = "demo-whrhs-cs-club";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

export function makeEnv() {
    return initializeTestEnvironment({
        projectId: PROJECT,
        database: { rules: read("database.rules.json") },
        storage: { rules: read("storage.rules") },
    });
}

export const AUTHOR = "authorUid";
export const OTHER = "otherUid";
export const EXEC = "execUid";

export const USERS = {
    [AUTHOR]: { uid: AUTHOR, role: "member", status: "approved" },
    [OTHER]: { uid: OTHER, role: "member", status: "approved" },
    [EXEC]: { uid: EXEC, role: "exec", status: "approved" },
};

export function downloadGame(fields = {}) {
    return {
        title: "Loaded Dice",
        category: "people",
        engine: "godot",
        format: "download",
        type: "download",
        platform: "windows",
        status: "pending",
        fileSize: 1234,
        embedUrl: "",
        authorUid: AUTHOR,
        authorName: "Author",
        timestamp: 1,
        ...fields,
    };
}

// Replaces the whole database, bypassing the rules.
export async function seedDatabase(env, data) {
    await env.withSecurityRulesDisabled(async (ctx) => {
        await ctx.database().ref().set(data);
    });
}

export const dbAs = (env, uid) => env.authenticatedContext(uid).database();
