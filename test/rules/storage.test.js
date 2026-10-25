// Storage rules for Arcade game files.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { AUTHOR, OTHER, makeEnv } from "./helpers.js";
import { webBuildMetadata } from "../../scriptFolder/arcade-games.js";

let env;
before(async () => { env = await makeEnv(); });
after(async () => { await env.cleanup(); });

const BYTES = new Uint8Array([1, 2, 3]);
const put = (uid, path, metadata) =>
    env.authenticatedContext(uid).storage().ref(path).put(BYTES, metadata);

// ---------- M3: WebGL builds hold web-build files only ----------

test("every file of typical web builds uploads with the client's metadata", async () => {
    const files = [
        // Loaded Dice / Unity WebGL (Brotli)
        "index.html", "Build/Gambers-Revenge.loader.js",
        "Build/Gambers-Revenge.framework.js.br", "Build/Gambers-Revenge.wasm.br",
        "Build/Gambers-Revenge.data.br", "TemplateData/style.css",
        "TemplateData/favicon.ico", "TemplateData/unity-logo-dark.png",
        "Build/Old.unityweb",
        // Godot web
        "game.js", "game.wasm", "game.pck", "game.audio.worklet.js", "game.png",
        // pygbag (Pygame)
        "game.apk", "favicon.png",
        // Phaser
        "main.mjs", "assets/map.json", "assets/hit.mp3", "assets/music.ogg",
        "assets/jump.wav", "assets/font.fnt", "assets/font.xml", "assets/font.woff2",
        "assets/sprite.webp", "assets/logo.svg", "credits.txt", "app.js.gz",
    ];
    for (const file of files) {
        const metadata = webBuildMetadata(file);
        assert.ok(metadata, file);
        await assertSucceeds(put(AUTHOR, `games/${AUTHOR}/g1/${file}`, metadata));
    }
});

test("executables and other files are refused", async () => {
    for (const [file, contentType] of [
        ["setup.exe", "application/octet-stream"],
        ["setup.exe.br", "application/octet-stream"],
        ["game.zip", "application/zip"],
        ["run.bat", "text/plain"],
        ["README.md", "text/plain"],
        ["noextension", "application/octet-stream"],
    ]) {
        assert.equal(webBuildMetadata(file), null, file);
        await assertFails(put(AUTHOR, `games/${AUTHOR}/g1/${file}`, { contentType }));
    }
});

test("content type must fit the extension", async () => {
    const base = `games/${AUTHOR}/g1`;
    await assertSucceeds(put(AUTHOR, `${base}/a.wasm`, { contentType: "application/wasm" }));
    await assertSucceeds(put(AUTHOR, `${base}/b.wasm.br`,
        { contentType: "application/wasm", contentEncoding: "br" }));
    await assertFails(put(AUTHOR, `${base}/c.html`, { contentType: "application/octet-stream" }));
    await assertFails(put(AUTHOR, `${base}/d.png`, { contentType: "text/html" }));
    await assertFails(put(AUTHOR, `${base}/e.js`, { contentType: "application/x-msdownload" }));
});

test("only the owner writes their game folder", async () => {
    await assertFails(put(OTHER, `games/${AUTHOR}/g1/index.html`,
        { contentType: "text/html; charset=utf-8" }));
    await assertFails(env.authenticatedContext(AUTHOR).storage()
        .ref(`games/${AUTHOR}/g1/index.html`).getDownloadURL());
});

// ---------- Card covers ----------

test("owners create, replace and delete their own WebP cover", async () => {
    const path = `covers/${AUTHOR}/g1/cover.webp`;
    const webp = { contentType: "image/webp" };
    await assertSucceeds(put(AUTHOR, path, webp));
    await assertSucceeds(put(AUTHOR, path, webp)); // replace
    await assertSucceeds(env.authenticatedContext(AUTHOR).storage().ref(path).delete());
});

test("covers are public to read and only the owner writes them", async () => {
    const path = `covers/${AUTHOR}/g2/cover.webp`;
    await env.withSecurityRulesDisabled(async (ctx) => {
        await ctx.storage().ref(path).put(BYTES, { contentType: "image/webp" });
    });
    await assertSucceeds(env.unauthenticatedContext().storage().ref(path).getMetadata());
    await assertFails(put(OTHER, path, { contentType: "image/webp" }));
    await assertFails(env.authenticatedContext(OTHER).storage().ref(path).delete());
    await assertFails(env.unauthenticatedContext().storage().ref(path)
        .put(BYTES, { contentType: "image/webp" }));
});

test("covers must be WebP, under 1 MB, at the fixed name", async () => {
    const base = `covers/${AUTHOR}/g3`;
    for (const contentType of ["image/png", "image/jpeg", "image/gif", "image/svg+xml", "text/html"]) {
        await assertFails(put(AUTHOR, `${base}/cover.webp`, { contentType }));
    }
    await assertFails(put(AUTHOR, `${base}/other.webp`, { contentType: "image/webp" }));
    await assertFails(put(AUTHOR, `covers/${AUTHOR}/bad.id/cover.webp`, { contentType: "image/webp" }));
    const big = new Uint8Array(1024 * 1024);
    await assertFails(env.authenticatedContext(AUTHOR).storage().ref(`${base}/cover.webp`)
        .put(big, { contentType: "image/webp" }));
    await assertSucceeds(env.authenticatedContext(AUTHOR).storage().ref(`${base}/cover.webp`)
        .put(big.subarray(1), { contentType: "image/webp" }));
});
