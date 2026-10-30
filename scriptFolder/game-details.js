// Optional Arcade game details: what the game is, who helped, known bugs.
// Shared by the upload modal (projects.js) and the play page (play.js).
// No Firebase imports, so the rules tests can use it too.
//
// The limits are also enforced in database.rules.json (games/$gameId).

export const DETAIL_FIELDS = [
    { key: "description", label: "About", max: 1000 },
    { key: "credits", label: "Credits", max: 300 },
    { key: "knownBugs", label: "Known bugs", max: 1000 },
];

// Trimmed values keyed by field; empty fields are null, so they're saved as
// absent rather than as empty strings. Over-long values are cut to the
// limit (textareas have maxlength, so this only matters if that's bypassed).
export function cleanDetails(raw) {
    const out = {};
    for (const { key, max } of DETAIL_FIELDS) {
        const value = String(raw?.[key] ?? "").trim().slice(0, max);
        out[key] = value || null;
    }
    return out;
}

// Only the fields that have a value, for spreading into a new record.
export function presentDetails(details) {
    return Object.fromEntries(Object.entries(details).filter(([, v]) => v !== null));
}

// Live "123 / 1000" counter under a textarea.
export function attachCounter(textarea, output, max) {
    const update = () => { output.textContent = `${textarea.value.length} / ${max}`; };
    textarea.addEventListener("input", update);
    update();
    return update;
}

// Fills `container` with a section per present field. Text only: values go
// in through textContent, never innerHTML, and line breaks are kept by CSS
// (white-space: pre-line). Hides the container when there's nothing.
export function renderDetails(container, game) {
    if (!container) return;
    container.replaceChildren();
    for (const { key, label } of DETAIL_FIELDS) {
        const value = typeof game?.[key] === "string" ? game[key].trim() : "";
        if (!value) continue;
        const section = document.createElement("section");
        section.className = "play-details-section";
        const heading = document.createElement("h2");
        heading.className = "play-details-label";
        heading.textContent = label;
        const body = document.createElement("p");
        body.className = "play-details-text";
        body.textContent = value;
        section.append(heading, body);
        container.append(section);
    }
    container.hidden = container.childElementCount === 0;
}

// ---------- Cover image ----------
//
// covers/{uid}/{gameId}/cover.webp, public to read (it isn't game
// content). storage.rules lets only the owner write it: WebP, under 1 MB.
// The record's coverUrl must be that object's download URL;
// database.rules.json checks the same prefix.

// Same shape as the card's top area (.pj-game-preview, aspect-ratio 16/10).
export const COVER_ASPECT = 16 / 10;
export const COVER_MAX_WIDTH = 1200;
export const MAX_COVER_BYTES = 1024 * 1024;
export const COVER_URL_PREFIX =
    "https://firebasestorage.googleapis.com/v0/b/whrhs-cs-club.firebasestorage.app/o/covers%2F";

export function coverPath(uid, gameId) {
    return `covers/${uid}/${gameId}/cover.webp`;
}

// True only for the download URL of this game's own cover object.
export function isCoverUrl(url, authorUid, gameId) {
    if (typeof url !== "string" || url.length > 2048 || !authorUid || !gameId) return false;
    return url.startsWith(`${COVER_URL_PREFIX}${authorUid}%2F${gameId}%2Fcover.webp?`);
}

const COVER_TYPES = {
    "image/png": /\.png$/i,
    "image/jpeg": /\.jpe?g$/i,
    "image/webp": /\.webp$/i,
};

// Center-crops an image to the card's 16:10 shape, scales it to at most
// 1200 px wide and re-encodes it as WebP (~0.8 quality). Throws an Error
// with a message for the user when the file can't be used.
export async function prepareCover(file) {
    const extension = COVER_TYPES[file?.type];
    if (!extension || !extension.test(file.name || "")) {
        throw new Error("The cover must be a PNG, JPEG or WebP image.");
    }
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error("That image couldn't be read.");
    }
    let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
    if (sw / sh > COVER_ASPECT) {
        sw = Math.round(sh * COVER_ASPECT);
        sx = Math.round((bitmap.width - sw) / 2);
    } else {
        sh = Math.round(sw / COVER_ASPECT);
        sy = Math.round((bitmap.height - sh) / 2);
    }
    const width = Math.max(1, Math.min(COVER_MAX_WIDTH, sw));
    const height = Math.max(1, Math.round(width / COVER_ASPECT));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.8));
    // Browsers that can't encode WebP hand back a PNG instead.
    if (!blob || blob.type !== "image/webp") {
        throw new Error("This browser can't create WebP images. Try Chrome, Edge or Firefox.");
    }
    if (blob.size >= MAX_COVER_BYTES) {
        throw new Error("That cover is still over 1 MB after compression. Try a simpler image.");
    }
    return { blob, previewUrl: URL.createObjectURL(blob) };
}
