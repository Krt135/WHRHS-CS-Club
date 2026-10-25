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
