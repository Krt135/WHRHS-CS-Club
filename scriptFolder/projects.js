import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "firebase/auth";
import { ref as dbRef, onValue, update, remove, get, set, push } from "firebase/database";

import * as fflate from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm";

const SUPABASE_URL = "https://yokredtutoeepddttvxi.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_EEb77E3TuyXU9ELGDvWxeQ_FdIL3vPQ";

let currentUser = null;
let currentUserRole = 'member'; // Default to member until fetched
let allGames = [];

let activeEngine = null; 
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
function updateFilterUI() {
    if (filterPeopleBtn) {
        filterPeopleBtn.style.borderColor = activeCategory === 'people' ? 'var(--primary)' : 'var(--border)';
        filterPeopleBtn.style.color = activeCategory === 'people' ? 'var(--primary)' : 'var(--muted-fg)';
    }
    
    if (filterGroupBtn) {
        filterGroupBtn.style.borderColor = activeCategory === 'group' ? 'var(--primary)' : 'var(--border)';
        filterGroupBtn.style.color = activeCategory === 'group' ? 'var(--primary)' : 'var(--muted-fg)';
    }

    Object.keys(engineTags).forEach(engine => {
        if (!engineTags[engine]) return;
        if (activeEngine === engine) {
            engineTags[engine].style.background = 'var(--primary)';
            engineTags[engine].style.color = 'var(--background)'; 
            engineTags[engine].style.borderColor = 'var(--primary)';
        } else {
            engineTags[engine].style.background = 'transparent';
            engineTags[engine].style.color = 'var(--muted-fg)';
            engineTags[engine].style.borderColor = 'var(--border)';
        }
    });
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
        gameGridContainer.innerHTML = `<div class="empty-state">No games found for this filter combination.</div>`;
        return;
    }

    let gridHTML = `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 1.5rem; text-align: left;">`;
    
    filteredGames.forEach(game => {
        // 🌟 CONDITIONAL DELETE BUTTON LOGIC
        // If the user is logged in AND (they uploaded it OR they are admin/exec)
        let deleteBtnHTML = "";
        if (currentUser && (currentUser.uid === game.authorUid || ['exec', 'admin'].includes(currentUserRole))) {
            deleteBtnHTML = `<button onclick="event.preventDefault(); window.deleteGame('${game.id}')" style="background: transparent; color: #ef4444; border: 1px solid #ef4444; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; margin-right: auto; transition: 0.2s;">DELETE</button>`;
        }

        gridHTML += `
            <a href="play.html?id=${game.id}" class="project-card">
                <div class="card-preview">
                    <div class="window-dots"><span></span><span></span><span></span></div>
                    <div class="preview-placeholder">
                        <span style="font-family: monospace; font-size: 1.5rem; font-weight: bold; color: #e5e5e5;">${game.engine || 'WEB'}</span>
                    </div>
                </div>
                <div class="card-footer" style="flex-direction: column; align-items: flex-start; gap: 0.5rem;">
                    <div>
                        <h3 style="font-size: 1.1rem;">${game.title}</h3>
                        <p>By: ${game.authorName}</p>
                    </div>
                    <div style="display: flex; width: 100%; justify-content: flex-end; align-items: center; margin-top: 4px;">
                        ${deleteBtnHTML}
                        <span class="card-open" style="align-self: flex-end;">Play →</span>
                    </div>
                </div>
            </a>
        `;
    });
    
    gridHTML += `</div>`;
    gameGridContainer.innerHTML = gridHTML;
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

        if (!SUPABASE_ANON_KEY) {
            alert("Configuration Error: Supabase API Key is missing.");
            return;
        }

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

                    uploadStatus.innerText = `Uploading file (${uploadProgressCount}/${totalFiles}) to Supabase...`;
                    const storagePath = `${currentUser.uid}/${projectKey}/${path}`;
                    
                    let contentType = "application/octet-stream";
                    if (path.endsWith(".html")) contentType = "text/html; charset=utf-8";
                    if (path.endsWith(".js"))   contentType = "application/javascript; charset=utf-8";
                    if (path.endsWith(".css"))  contentType = "text/css; charset=utf-8";
                    if (path.endsWith(".wasm")) contentType = "application/wasm";
                    if (path.endsWith(".png"))  contentType = "image/png";

                    const uploadResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/games/${storagePath}`, {
                        method: 'POST',
                        headers: {
                            'apikey': SUPABASE_ANON_KEY,
                            'Content-Type': contentType,
                            'x-upsert': 'true' 
                        },
                        body: contentData
                    });

                    if (!uploadResponse.ok) {
                        const errText = await uploadResponse.text();
                        throw new Error(`Supabase Error: ${errText}`);
                    }

                    if (path === "index.html") {
                        finalEmbedUrl = `${SUPABASE_URL}/storage/v1/object/public/games/${storagePath}`;
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