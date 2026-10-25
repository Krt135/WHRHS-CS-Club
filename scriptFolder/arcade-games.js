// Shared Arcade game metadata. Game records store a stable lowercase engine
// value; labels live here. Older records used "Unity", "Pygame", "JSCanvas"
// or "Other", so every read goes through normalizeEngine() instead of
// rewriting the data.

export const ENGINES = [
    { value: "unity", label: "Unity" },
    { value: "pygame", label: "Pygame" },
    { value: "phaser", label: "Phaser" },
    { value: "godot", label: "Godot" },
    { value: "other", label: "Other / Web" },
];

const ENGINE_VALUES = new Set(ENGINES.map(e => e.value));

// Lowercase known values; anything else (legacy "JSCanvas", missing, typos)
// counts as "other".
export function normalizeEngine(raw) {
    const value = String(raw ?? "").trim().toLowerCase();
    return ENGINE_VALUES.has(value) ? value : "other";
}

export function engineLabel(raw) {
    const value = normalizeEngine(raw);
    return ENGINES.find(e => e.value === value).label;
}

// Deployment format: "webgl" (zip build served by the arcade function),
// "external" (a link to another site) or "download" (a zip players download).
// Records from before `format` existed only have `type`: "game" was an
// uploaded build, anything else an external link.
const FORMATS = new Set(["webgl", "external", "download"]);

export function gameFormat(game) {
    if (game && FORMATS.has(game.format)) return game.format;
    return game && game.type === "game" ? "webgl" : "external";
}

// Windows download builds: also enforced in storage.rules and the
// database rules.
export const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

export function formatFileSize(bytes) {
    if (typeof bytes !== "number" || !(bytes > 0)) return "";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    const mb = bytes / (1024 * 1024);
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
// What an exec's restore writes back to games/{id}. A restored Windows
// download always goes back to review: the moderation copy could have been
// edited, and only the approveDownload function may approve a build.
export function restoredGameRecord(data) {
    if (gameFormat(data) !== "download") return data;
    const { buildGeneration, ...rest } = data;
    return { ...rest, status: "pending" };
}

// Files a WebGL build may contain, with the Content-Type each is stored
// under (the decompressed payload's type for .br/.gz files). storage.rules
// (isWebBuildFile) allows the same extensions and types; keep them in step.
const WEB_BUILD_TYPES = {
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    mjs: "application/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    wasm: "application/wasm",
    data: "application/octet-stream",
    unityweb: "application/octet-stream",
    pck: "application/octet-stream",
    apk: "application/octet-stream",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    txt: "text/plain; charset=utf-8",
    fnt: "text/plain; charset=utf-8",
    xml: "application/xml",
};

// Upload metadata for a file in a WebGL build, or null when the file type
// isn't allowed in one (it would be refused by storage.rules).
export function webBuildMetadata(path) {
    let contentEncoding;
    let typePath = path.toLowerCase();
    if (typePath.endsWith(".br")) { contentEncoding = "br"; typePath = typePath.slice(0, -3); }
    else if (typePath.endsWith(".gz")) { contentEncoding = "gzip"; typePath = typePath.slice(0, -3); }
    const name = typePath.slice(typePath.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    const contentType = dot > 0 ? WEB_BUILD_TYPES[name.slice(dot + 1)] : undefined;
    if (!contentType) return null;
    return contentEncoding ? { contentType, contentEncoding } : { contentType };
}
