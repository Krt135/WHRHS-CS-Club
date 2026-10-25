import { auth, db, storage } from "./firebase.js";
import { onAuthStateChanged } from "firebase/auth";
import { ref as dbRef, onValue, update, remove, get, set, push } from "firebase/database";
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { createScrollTrigger, scaleUp } from "./animations.js";
import { registerTerminal } from "./init-terminal-animations.js";
import { fetchArcadeStatus, arcadeDownloadUrl, LOCK_MESSAGE, UNREACHABLE_MESSAGE } from "./arcade-lock.js";
import { normalizeEngine, engineLabel, gameFormat, formatFileSize, isHttpsUrl, webBuildMetadata, MAX_DOWNLOAD_BYTES } from "./arcade-games.js";
import { DETAIL_FIELDS, attachCounter, cleanDetails, coverPath, isCoverUrl, prepareCover, presentDetails } from "./game-details.js";

import * as fflate from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm";

let currentUser = null;
let currentUserRole = 'member'; // Default to member until fetched
let allGames = [];

let activeEngine = null; 
let hasPlayedCardTerminals = false;
let activeCategory = 'people';

// Play links stay disabled until the server says the Arcade is open.
let arcadePlayable = false;
const ARCADE_STATUS_REFRESH_MS = 60 * 1000;

const gameGridContainer = document.getElementById("gameGridContainer");
const filterPeopleBtn = document.getElementById("filter-people");
const filterGroupBtn = document.getElementById("filter-group");
// "Made with" chips, keyed by stored engine value (see arcade-games.js).
const engineTags = {};
document.querySelectorAll("[data-engine-filter]").forEach(btn => {
    engineTags[btn.dataset.engineFilter] = btn;
});

// ─── 1. AUTHENTICATION & DATA FETCHING ────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        // 🌟 Fetch the user's role so we know if they get global delete powers
        const snap = await get(dbRef(db, `users/${user.uid}`));
        if (snap.exists()) {
            currentUserRole = snap.val().role || 'member';
        }
    } else {
        currentUser = null;
        currentUserRole = 'member';
    }
    // Re-render games once auth state loads to show/hide delete buttons
    renderGames();
});

const projectsRef = dbRef(db, 'games');
onValue(projectsRef, (snapshot) => {
    allGames = [];
    if (snapshot.exists()) {
        snapshot.forEach(childSnap => {
            allGames.push(childSnap.val());
        });
        allGames.sort((a, b) => b.timestamp - a.timestamp);
    }
    renderGames();
});

// ─── 2. FILTERING LOGIC ───────────────────────────────────────────
function setActive(button, isActive) {
    if (!button) return;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
}

function updateFilterUI() {
    setActive(filterPeopleBtn, activeCategory === 'people');
    setActive(filterGroupBtn, activeCategory === 'group');
    Object.keys(engineTags).forEach(engine => setActive(engineTags[engine], activeEngine === engine));
}

if (filterPeopleBtn) filterPeopleBtn.addEventListener("click", () => { activeCategory = 'people'; renderGames(); });
if (filterGroupBtn) filterGroupBtn.addEventListener("click", () => { activeCategory = 'group'; renderGames(); });

Object.keys(engineTags).forEach(engine => {
    if (engineTags[engine]) {
        engineTags[engine].addEventListener("click", () => {
            activeEngine = activeEngine === engine ? null : engine;
            renderGames();
        });
    }
});

function renderGames() {
    updateFilterUI();
    if (!gameGridContainer) return;
    
    gameGridContainer.innerHTML = "";

    const filteredGames = allGames.filter(game => {
        // Download builds stay hidden until an exec approves them, except
        // from their own author. The server refuses unapproved downloads
        // either way; this only keeps the grid tidy.
        if (gameFormat(game) === "download" && game.status !== "approved"
            && !(currentUser && currentUser.uid === game.authorUid)) return false;
        const matchesCategory = game.category === activeCategory;
        const matchesEngine = activeEngine ? normalizeEngine(game.engine) === activeEngine : true;
        return matchesCategory && matchesEngine;
    });

    if (filteredGames.length === 0) {
        gameGridContainer.innerHTML = `<div class="pj-empty">No games found for this filter combination.</div>`;
        return;
    }

    gameGridContainer.innerHTML = filteredGames.map(game => {
        const playUrl = `play.html?id=${encodeURIComponent(game.id)}`;
        const author = game.authorName || 'Anonymous';
        const canDelete = currentUser && (currentUser.uid === game.authorUid || ['exec', 'admin'].includes(currentUserRole));
        const deleteBtnHTML = canDelete
            ? `<button type="button" class="pj-game-delete" data-delete-id="${escapeHTML(game.id)}">Delete</button>`
            : "";
        const isDownload = gameFormat(game) === "download";
        const approved = !isDownload || game.status === "approved";
        let linkAttrs = arcadePlayable ? `href="${playUrl}"` : `aria-disabled="true"`;
        let actionLabel = arcadePlayable ? 'Play →' : 'Locked';
        if (!approved) {
            linkAttrs = `aria-disabled="true"`;
            actionLabel = game.status === "rejected" ? 'Rejected by exec' : 'Pending exec review';
        } else if (isDownload) {
            // Opens the download notice first (see the click handler below).
            linkAttrs = arcadePlayable
                ? `href="${arcadeDownloadUrl(game.id)}" data-download-id="${escapeHTML(game.id)}"`
                : `aria-disabled="true"`;
            const size = formatFileSize(game.fileSize);
            actionLabel = arcadePlayable ? `Download for Windows${size ? ` · ${size}` : ''} ↓` : 'Locked';
        }
        const stateClass = !approved ? ' is-pending' : (arcadePlayable ? '' : ' is-locked');

        return `
            <article class="pj-game${stateClass}" data-engine="${normalizeEngine(game.engine)}">
                <a class="pj-game-link" ${linkAttrs}>
                    ${previewHTML(game)}
                    <div class="pj-game-body">
                        <h3>${escapeHTML(game.title)}</h3>
                        <p>By ${escapeHTML(author)}</p>
                    </div>
                </a>
                <div class="pj-game-foot">
                    <a class="pj-game-author" href="account.html?user=${encodeURIComponent(game.authorUid || '')}"
                       title="View ${escapeHTML(author)}'s profile" aria-label="View ${escapeHTML(author)}'s profile">${escapeHTML(author.substring(0, 2).toUpperCase())}</a>
                    ${deleteBtnHTML}
                    <a class="pj-game-play" ${linkAttrs} tabindex="-1" aria-hidden="true">${actionLabel}</a>
                </div>
            </article>
        `;
    }).join("");

    // First load: each card "loads" through a compact terminal. After that,
    // filter changes just ripple the cards in so the terminal doesn't replay.
    const cards = [...gameGridContainer.children];
    if (!hasPlayedCardTerminals) {
        hasPlayedCardTerminals = true;
        cards.forEach(card => {
            card.dataset.terminalCommand = "$ load_project()";
            card.setAttribute("data-terminal-compact", "");
            registerTerminal(card);
        });
    } else {
        cards.forEach((card, i) => {
            createScrollTrigger(card, scaleUp, { delay: (i % 4) * 0.06, animationOptions: { from: 0.9 } });
        });
    }
}

// ─── 2b. ARCADE LOCK ──────────────────────────────────────────────
// The server enforces the lock on the game files; this just keeps the cards
// and notice in step with it. Re-renders only when open/locked flips, so the
// card animations don't replay every minute.
const arcadeLockNotice = document.getElementById("arcadeLockNotice");

async function refreshArcadeStatus() {
    let playable = false;
    let message = UNREACHABLE_MESSAGE;
    try {
        const status = await fetchArcadeStatus();
        playable = status.open;
        message = LOCK_MESSAGE;
    } catch (err) {
        console.error("Arcade status unavailable:", err);
    }

    if (arcadeLockNotice) {
        arcadeLockNotice.textContent = playable ? "" : message;
        arcadeLockNotice.hidden = playable;
    }
    if (playable !== arcadePlayable) {
        arcadePlayable = playable;
        renderGames();
    }
}

if (gameGridContainer) {
    refreshArcadeStatus();
    setInterval(() => {
        if (document.visibilityState === "visible") refreshArcadeStatus();
    }, ARCADE_STATUS_REFRESH_MS);
}

// Top of a card: the member's cover with a small engine badge, or the
// engine panel with the accent slash when there's no (valid) cover.
function previewHTML(game) {
    const engine = escapeHTML(engineLabel(game.engine));
    if (!isCoverUrl(game.coverUrl, game.authorUid, game.id)) {
        return `<div class="pj-game-preview"><span class="pj-game-engine">${engine}</span></div>`;
    }
    return `<div class="pj-game-preview has-cover">
                        <img class="pj-game-cover" src="${escapeHTML(game.coverUrl)}" alt="${escapeHTML(game.title || "Game cover")}" loading="lazy" width="1200" height="750">
                        <span class="pj-game-badge">${engine}</span>
                    </div>`;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

if (gameGridContainer) {
    gameGridContainer.addEventListener("click", (e) => {
        const deleteBtn = e.target.closest("[data-delete-id]");
        if (deleteBtn) window.deleteGame(deleteBtn.dataset.deleteId);

        const downloadLink = e.target.closest("[data-download-id]");
        if (downloadLink) {
            e.preventDefault();
            openDownloadNotice(downloadLink.dataset.downloadId);
        }
    });
}

// ─── 2c. WINDOWS DOWNLOAD NOTICE ──────────────────────────────────
// Shown before every download. The lock is enforced by the server (423
// while locked); once a build is downloaded, nothing can lock it.
const downloadNotice = document.getElementById("downloadNotice");
let pendingDownloadId = null;

function openDownloadNotice(gameId) {
    if (!downloadNotice || !arcadePlayable) return;
    pendingDownloadId = gameId;
    downloadNotice.style.display = "flex";
    document.getElementById("downloadNoticeConfirm")?.focus();
}

function closeDownloadNotice() {
    pendingDownloadId = null;
    if (downloadNotice) downloadNotice.style.display = "none";
}

document.getElementById("downloadNoticeCancel")?.addEventListener("click", closeDownloadNotice);
document.getElementById("downloadNoticeConfirm")?.addEventListener("click", () => {
    const gameId = pendingDownloadId;
    closeDownloadNotice();
    if (gameId) window.location.assign(arcadeDownloadUrl(gameId));
});
downloadNotice?.addEventListener("click", (e) => {
    if (e.target === downloadNotice) closeDownloadNotice();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && pendingDownloadId) closeDownloadNotice();
});

// ─── 3. DELETE TO MODERATION PIPELINE ─────────────────────────────

window.deleteGame = async (gameId) => {
    if (!confirm("Are you sure you want to delete this game?")) return;
    if (!confirm("This game will be removed from the arcade and moved to the moderation queue. Proceed?")) return;

    try {
        const gameSnap = await get(dbRef(db, `games/${gameId}`));
        if (!gameSnap.exists()) return alert("Game no longer exists.");
        
        const gameData = gameSnap.val();

        const moderationPayload = {
            ...gameData, 
            _deletedFrom: 'games',
            _originalId: gameId, 
            _sourceLabel: 'Arcade Project',
            _deletedAt: Date.now(),
            _deletedBy: currentUser.displayName || currentUser.email.split('@')[0],
            _deletedById: currentUser.uid
        };

        const updates = {};
        updates[`games/${gameId}`] = null;
        updates[`deleted_posts/${gameId}`] = moderationPayload;

        // Use dbRef(db) to target the root node atomically
        await update(dbRef(db), updates);
        console.log("Game successfully moved to Moderation.");

    } catch (error) {
        console.error("Soft Delete Failed:", error);
        alert("Failed to move game to moderation: " + error.message);
    }
};

// ─── 4. MODAL & UPLOAD PIPELINE ───────────────────────────────────
const projFormat = document.getElementById("projFormat");
const submitUploadBtn = document.getElementById("submitUploadBtn");
const uploadStatus = document.getElementById("uploadStatus");

// Show only the fields for the selected deployment format.
function showFormatFields() {
    document.querySelectorAll("[data-format-group]").forEach(group => {
        group.hidden = group.dataset.formatGroup !== projFormat.value;
    });
}

if (projFormat) {
    projFormat.addEventListener("change", showFormatFields);
    showFormatFields();
}

// Optional details textareas (data-detail="description" etc.) with counters.
const detailInputs = {};
const detailCounters = [];
for (const { key, max } of DETAIL_FIELDS) {
    const textarea = document.querySelector(`#uploadModal [data-detail="${key}"]`);
    if (!textarea) continue;
    detailInputs[key] = textarea;
    const counter = document.getElementById(textarea.getAttribute("aria-describedby"));
    if (counter) detailCounters.push(attachCounter(textarea, counter, max));
}

// Optional cover: processed as soon as it's picked, so the preview shows
// before submitting and a bad file is reported right away.
const coverInput = document.getElementById("projCover");
const coverPreview = document.getElementById("projCoverPreview");
const coverError = document.getElementById("projCoverError");
let pendingCover = null;

function clearCover() {
    if (pendingCover) URL.revokeObjectURL(pendingCover.previewUrl);
    pendingCover = null;
    if (coverPreview) { coverPreview.hidden = true; coverPreview.removeAttribute("src"); }
}

coverInput?.addEventListener("change", async () => {
    clearCover();
    coverError.textContent = "";
    const file = coverInput.files[0];
    if (!file) return;
    try {
        pendingCover = await prepareCover(file);
        coverPreview.src = pendingCover.previewUrl;
        coverPreview.hidden = false;
    } catch (error) {
        coverInput.value = "";
        coverError.textContent = error.message;
    }
});

if (submitUploadBtn) {
    submitUploadBtn.addEventListener("click", async () => {
        if (!currentUser) return alert("Access denied: Please log in first.");
        
        const title = document.getElementById("projTitle").value.trim();
        const category = document.getElementById("projCategory").value;
        const engine = document.getElementById("projEngine").value;
        const format = projFormat.value;
        const uploadProgress = document.getElementById("uploadProgress");
        const details = presentDetails(cleanDetails(Object.fromEntries(
            Object.entries(detailInputs).map(([key, el]) => [key, el.value]))));
        
        if (!title) return alert("Please specify a project title.");

        submitUploadBtn.disabled = true;
        uploadStatus.innerText = "Verifying permissions...";

        try {
            if (category === "group") {
                if (currentUserRole !== 'exec' && currentUserRole !== 'admin') {
                    throw new Error("Access Denied: Only Executive Board members can upload Group Games.");
                }
            }

            const projectKey = push(dbRef(db, 'games')).key;
            let finalEmbedUrl = "";
            let downloadFields = {};

            if (format === "webgl") {
                const zipFileInput = document.getElementById("projZipFile");
                if (!zipFileInput.files.length) throw new Error("Please select a valid .zip file.");
                
                const file = zipFileInput.files[0];
                const buffer = await file.arrayBuffer();
                const zipData = new Uint8Array(buffer);

                uploadStatus.innerText = "Extracting zip via fflate...";
                const unzipped = fflate.unzipSync(zipData);
                
                const filesArray = Object.entries(unzipped);
                const totalFiles = filesArray.length;
                let uploadProgressCount = 0;
                const skipped = [];

                for (const [path, contentData] of filesArray) {
                    if (path.endsWith('/') || path.includes('__MACOSX')) {
                        uploadProgressCount++;
                        continue;
                    }

                    // Only web-build file types (see WEB_BUILD_TYPES); anything
                    // else, like a README or an .exe, stays out of the Arcade.
                    const metadata = webBuildMetadata(path);
                    if (!metadata) {
                        skipped.push(path);
                        uploadProgressCount++;
                        continue;
                    }

                    uploadStatus.innerText = `Uploading file (${uploadProgressCount}/${totalFiles}) to Firebase Storage...`;
                    const storagePath = `games/${currentUser.uid}/${projectKey}/${path}`;
                    
                    // Unity WebGL compressed builds ship files like "game.framework.js.br".
                    // webBuildMetadata stores Content-Encoding on those, so the browser
                    // decompresses natively, with the *decompressed* payload's Content-Type.
                    try {
                        await uploadBytes(ref(storage, storagePath), contentData, metadata);
                    } catch (err) {
                        throw new Error(`Firebase Storage Error: ${err.message}`);
                    }

                    if (path === "index.html") {
                        finalEmbedUrl = `https://storage.googleapis.com/whrhs-cs-club.firebasestorage.app/${storagePath}`;
                    }
                    uploadProgressCount++;
                }

                if (!finalEmbedUrl) throw new Error("Validation failure: index.html was not found inside the zip file.");
                if (skipped.length) {
                    console.warn("Skipped files that aren't part of a web build:", skipped);
                    alert(`Skipped ${skipped.length} file(s) that aren't web-build files: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? ", ..." : ""}`);
                }

            } else if (format === "download") {
                const file = document.getElementById("projDownloadZip").files[0];
                const platform = document.getElementById("projPlatform").value;
                if (!file) throw new Error("Please select your zipped Windows export folder.");
                if (/\.exe$/i.test(file.name)) {
                    throw new Error("Upload a .zip of the whole export folder, not the .exe by itself. The game won't run without its data folder / .pck.");
                }
                if (!/\.zip$/i.test(file.name)) throw new Error("Windows downloads must be a single .zip file.");
                if (file.size === 0) throw new Error("That zip is empty.");
                if (file.size > MAX_DOWNLOAD_BYTES) {
                    throw new Error(`That zip is ${formatFileSize(file.size)}. The limit is 500 MB.`);
                }
                // Every zip starts with "PK" (0x50 0x4B).
                const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer());
                if (magic[0] !== 0x50 || magic[1] !== 0x4B) throw new Error("That file isn't a valid .zip.");
                if (platform !== "windows") throw new Error("Choose a platform.");

                uploadProgress.value = 0;
                uploadProgress.hidden = false;
                await new Promise((resolve, reject) => {
                    const task = uploadBytesResumable(
                        ref(storage, `downloads/${currentUser.uid}/${projectKey}/build.zip`),
                        file, { contentType: "application/zip" });
                    task.on("state_changed", (snap) => {
                        const pct = snap.totalBytes ? Math.round(snap.bytesTransferred / snap.totalBytes * 100) : 0;
                        uploadProgress.value = pct;
                        uploadStatus.innerText = `Uploading ${pct}% (${formatFileSize(snap.bytesTransferred)} of ${formatFileSize(snap.totalBytes)})...`;
                    }, (err) => reject(new Error(`Firebase Storage Error: ${err.message}`)), resolve);
                });
                downloadFields = { platform, fileSize: file.size, status: "pending" };

            } else {
                finalEmbedUrl = document.getElementById("projExternalUrl").value.trim();
                if (!finalEmbedUrl) throw new Error("Please configure a routing URL link.");
                if (!isHttpsUrl(finalEmbedUrl)) throw new Error("The link must be a full https:// URL.");
            }

            let coverFields = {};
            if (pendingCover) {
                uploadStatus.innerText = "Uploading cover image...";
                const coverRef = ref(storage, coverPath(currentUser.uid, projectKey));
                await uploadBytes(coverRef, pendingCover.blob, { contentType: "image/webp" });
                coverFields = { coverUrl: await getDownloadURL(coverRef) };
            }

            uploadStatus.innerText = "Saving to Firebase database...";
            await set(dbRef(db, `games/${projectKey}`), {
                id: projectKey,
                title: title,
                category: category,
                engine: engine,
                format: format,
                // `type` is what older code and the arcade function read.
                type: { webgl: "game", external: "web", download: "download" }[format],
                ...downloadFields,
                ...details,
                ...coverFields,
                embedUrl: finalEmbedUrl,
                authorUid: currentUser.uid,
                authorName: currentUser.displayName || currentUser.email.split('@')[0],
                timestamp: Date.now()
            });

            uploadStatus.innerText = format === "download"
                ? "Uploaded! An exec will review it before it appears in the Arcade."
                : "Deployment compiled completely!";
            setTimeout(() => { 
                if (typeof toggleUploadModal === "function") toggleUploadModal(false);
                submitUploadBtn.disabled = false;
                uploadStatus.innerText = "";
                uploadProgress.hidden = true;
                if (coverInput) coverInput.value = "";
                clearCover();
            }, format === "download" ? 3000 : 1200);

        } catch (error) {
            console.error(error);
            uploadStatus.innerText = `Error: ${error.message}`;
            uploadProgress.hidden = true;
            submitUploadBtn.disabled = false;
        }
    });
}