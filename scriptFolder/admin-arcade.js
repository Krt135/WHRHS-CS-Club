// ARCADE tab of the admin panel (exec and admin): lists pending Windows
// download builds. Execs download one for review through the arcade
// function (role checked there), then approve or reject it through the
// approveDownload function. Approval sends back the object generation the
// exec downloaded, so the server approves exactly that file; the database
// rules don't let any client set status "approved".
import { auth, db } from "./firebase.js";
import { getFunctions, httpsCallable } from "firebase/functions";
import { equalTo, onValue, orderByChild, query, ref } from "firebase/database";
import { arcadeDownloadUrl } from "./arcade-urls.js";
import { formatFileSize } from "./arcade-games.js";
import { escapeHTML } from "./sponsor-data.js";

// gameId -> object generation of the build this exec downloaded for review
// in this page session. APPROVE stays disabled until there's an entry.
const reviewedGenerations = new Map();

export function mountArcadeTab(container) {
    container.innerHTML = `
        <div class="sponsor-admin">
            <section class="admin-panel">
                <h2 class="member-section-title">ARCADE · PENDING WINDOWS DOWNLOADS</h2>
                <p class="admin-summary">Scan with Windows Defender/VirusTotal before approving.</p>
                <p class="admin-form-status" id="arcadePendingStatus" aria-live="polite"></p>
                <div id="arcadePendingList"><p class="admin-summary">Loading...</p></div>
            </section>
        </div>
    `;

    const pendingList = container.querySelector("#arcadePendingList");
    const pendingStatus = container.querySelector("#arcadePendingStatus");
    const approveDownload = httpsCallable(getFunctions(auth.app), "approveDownload");
    let pendingGames = [];

    const renderPending = (games) => {
        pendingGames = games;
        if (!games.length) {
            pendingList.innerHTML = `<p class="admin-summary">No download builds are waiting for review.</p>`;
            return;
        }
        pendingList.innerHTML = games.map((game) => `
            <div class="admin-list-item">
                <div class="member-details">
                    <div class="member-name">${escapeHTML(game.title || "Untitled")}</div>
                    <div class="member-email">By ${escapeHTML(game.authorName || "Unknown")} · ${escapeHTML(game.platform || "windows")} · ${escapeHTML(formatFileSize(game.fileSize) || "size unknown")} · ${game.timestamp ? escapeHTML(new Date(game.timestamp).toLocaleString()) : ""}</div>
                </div>
                <div class="admin-actions">
                    <button type="button" class="btn-neutral" data-review="${escapeHTML(game.id)}">DOWNLOAD TO REVIEW</button>
                    <button type="button" class="btn-approve" data-approve="${escapeHTML(game.id)}"${reviewedGenerations.has(game.id) ? "" : ` disabled title="Download it to review first."`}>APPROVE</button>
                    <button type="button" class="btn-deny" data-reject="${escapeHTML(game.id)}">REJECT</button>
                </div>
            </div>
        `).join("");
    };

    const pendingQuery = query(ref(db, "games"), orderByChild("status"), equalTo("pending"));
    const stopPending = onValue(pendingQuery, (snapshot) => {
        const games = [];
        snapshot.forEach((child) => {
            const game = child.val();
            if (game && game.format === "download") games.push({ ...game, id: child.key });
        });
        games.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        renderPending(games);
    }, (error) => {
        console.error("Pending downloads unavailable:", error);
        pendingList.innerHTML = `<p class="admin-summary">Could not load pending downloads.</p>`;
    });

    const review = async (gameId) => {
        pendingStatus.textContent = "Getting a review link...";
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(arcadeDownloadUrl(gameId, true), {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
            });
            if (!res.ok) throw new Error(`The server refused (HTTP ${res.status}).`);
            const { url, generation } = await res.json();
            reviewedGenerations.set(gameId, generation);
            renderPending(pendingGames);
            pendingStatus.textContent = "Download started. Scan it before running it.";
            window.location.assign(url);
        } catch (error) {
            console.error("Review download failed:", error);
            pendingStatus.textContent = error.message || "Could not get the build.";
        }
    };

    const setStatus = async (gameId, decision) => {
        pendingStatus.textContent = "Saving...";
        try {
            await approveDownload({ gameId, decision, generation: reviewedGenerations.get(gameId) });
            pendingStatus.textContent = decision === "approved"
                ? "Approved. It now shows in the Arcade."
                : "Rejected. The author sees it as rejected and can delete it.";
        } catch (error) {
            console.error("Status change failed:", error);
            // e.g. the build changed since it was downloaded: review it again.
            if (error.code === "functions/failed-precondition") reviewedGenerations.delete(gameId);
            renderPending(pendingGames);
            pendingStatus.textContent = error.message || "Could not save.";
        }
    };

    pendingList.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        if (btn.dataset.review) review(btn.dataset.review);
        if (btn.dataset.approve && reviewedGenerations.has(btn.dataset.approve) && confirm("Approve this build? Anyone will be able to download it.")) {
            setStatus(btn.dataset.approve, "approved");
        }
        if (btn.dataset.reject && confirm("Reject this build?")) setStatus(btn.dataset.reject, "rejected");
    });

    return () => {
        stopPending();
    };
}
