import { auth, db, storage } from "./firebase.js";
import { onAuthStateChanged } from "firebase/auth";
import { ref as dbRef, onValue, update, remove, get, set, push } from "firebase/database";
import { ref, uploadBytes } from "firebase/storage";
import { createScrollTrigger, scaleUp } from "./animations.js";
import { registerTerminal } from "./init-terminal-animations.js";

import * as fflate from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm";

let currentUser = null;
let currentUserRole = 'member'; // Default to member until fetched
let allGames = [];

let activeEngine = null; 
let hasPlayedCardTerminals = false;
let activeCategory = 'people'; 

const gameGridContainer = document.getElementById("gameGridContainer");
const filterPeopleBtn = document.getElementById("filter-people");
const filterGroupBtn = document.getElementById("filter-group");
const engineTags = {
    Unity: document.getElementById("tag-Unity"),
    Pygame: document.getElementById("tag-Pygame"),
    JSCanvas: document.getElementById("tag-JSCanvas")
};

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
        const matchesCategory = game.category === activeCategory;
        const matchesEngine = activeEngine ? game.engine === activeEngine : true;
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

        return `
            <article class="pj-game" data-engine="${escapeHTML(game.engine || 'Other')}">
                <a class="pj-game-link" href="${playUrl}">
                    <div class="pj-game-preview"><span class="pj-game-engine">${escapeHTML(ENGINE_LABELS[game.engine] || game.engine || 'Web')}</span></div>
                    <div class="pj-game-body">
                        <h3>${escapeHTML(game.title)}</h3>
                        <p>By ${escapeHTML(author)}</p>
                    </div>
                </a>
                <div class="pj-game-foot">
                    <a class="pj-game-author" href="account.html?user=${encodeURIComponent(game.authorUid || '')}"
                       title="View ${escapeHTML(author)}'s profile" aria-label="View ${escapeHTML(author)}'s profile">${escapeHTML(author.substring(0, 2).toUpperCase())}</a>
                    ${deleteBtnHTML}
                    <a class="pj-game-play" href="${playUrl}" tabindex="-1" aria-hidden="true">Play →</a>
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

const ENGINE_LABELS = { JSCanvas: 'JS Canvas' };

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

if (gameGridContainer) {
    gameGridContainer.addEventListener("click", (e) => {
        const deleteBtn = e.target.closest("[data-delete-id]");
        if (deleteBtn) window.deleteGame(deleteBtn.dataset.deleteId);
    });
}

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
const projType = document.getElementById("projType");
const gameUploadGroup = document.getElementById("gameUploadGroup");
const webUploadGroup = document.getElementById("webUploadGroup");
const submitUploadBtn = document.getElementById("submitUploadBtn");
const uploadStatus = document.getElementById("uploadStatus");

if (projType) {
    projType.addEventListener("change", (e) => {
        if (e.target.value === "game") {
            gameUploadGroup.style.display = "block";
            webUploadGroup.style.display = "none";
        } else {
            gameUploadGroup.style.display = "none";
            webUploadGroup.style.display = "block";
        }
    });
}

if (submitUploadBtn) {
    submitUploadBtn.addEventListener("click", async () => {
        if (!currentUser) return alert("Access denied: Please log in first.");
        
        const title = document.getElementById("projTitle").value.trim();
        const category = document.getElementById("projCategory").value;
        const engine = document.getElementById("projEngine").value;
        const type = projType.value;
        
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

            if (type === "game") {
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

                for (const [path, contentData] of filesArray) {
                    if (path.endsWith('/') || path.includes('__MACOSX')) {
                        uploadProgressCount++;
                        continue;
                    }

                    uploadStatus.innerText = `Uploading file (${uploadProgressCount}/${totalFiles}) to Firebase Storage...`;
                    const storagePath = `games/${currentUser.uid}/${projectKey}/${path}`;
                    
                    // Unity WebGL compressed builds ship files like "game.framework.js.br".
                    // Storing Content-Encoding on the object makes Cloud Storage send that header,
                    // so the browser decompresses natively; the Content-Type must describe the
                    // *decompressed* payload (e.g. JS or wasm), not the .br/.gz wrapper.
                    let contentEncoding;
                    let typePath = path;
                    if (path.endsWith(".br")) { contentEncoding = "br";   typePath = path.slice(0, -3); }
                    if (path.endsWith(".gz")) { contentEncoding = "gzip"; typePath = path.slice(0, -3); }

                    let contentType = "application/octet-stream";
                    if (typePath.endsWith(".html")) contentType = "text/html; charset=utf-8";
                    if (typePath.endsWith(".js"))   contentType = "application/javascript; charset=utf-8";
                    if (typePath.endsWith(".css"))  contentType = "text/css; charset=utf-8";
                    if (typePath.endsWith(".wasm")) contentType = "application/wasm";
                    if (typePath.endsWith(".png"))  contentType = "image/png";

                    const metadata = contentEncoding ? { contentType, contentEncoding } : { contentType };

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

            } else {
                finalEmbedUrl = document.getElementById("projExternalUrl").value.trim();
                if (!finalEmbedUrl) throw new Error("Please configure a routing URL link.");
            }

            uploadStatus.innerText = "Saving to Firebase database...";
            await set(dbRef(db, `games/${projectKey}`), {
                id: projectKey,
                title: title,
                category: category,
                engine: engine,
                type: type,
                embedUrl: finalEmbedUrl,
                authorUid: currentUser.uid,
                authorName: currentUser.displayName || currentUser.email.split('@')[0],
                timestamp: Date.now()
            });

            uploadStatus.innerText = "Deployment compiled completely!";
            setTimeout(() => { 
                if (typeof toggleUploadModal === "function") toggleUploadModal(false);
                submitUploadBtn.disabled = false;
                uploadStatus.innerText = "";
            }, 1200);

        } catch (error) {
            console.error(error);
            uploadStatus.innerText = `Error: ${error.message}`;
            submitUploadBtn.disabled = false;
        }
    });
}