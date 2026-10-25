// ARCADE tab of the admin panel (exec and admin): unlock the Arcade for
// everyone until midnight with the override code, or end an override early.
// The setArcadeOverride function checks the caller's role and the code's
// SHA-256 hash on the server (functions/arcade.js); nothing about the code
// lives in this file.
//
// It also lists pending Windows download builds. Execs download one for
// review through the arcade function (role checked there, lock still
// applies), then approve or reject it. The database rules only let
// exec/admin change a game's status.
import { auth, db } from "./firebase.js";
import { getFunctions, httpsCallable } from "firebase/functions";
import { equalTo, onValue, orderByChild, query, ref, update } from "firebase/database";
import { arcadeDownloadUrl, fetchArcadeStatus, CHECKING_MESSAGE, UNREACHABLE_MESSAGE } from "./arcade-lock.js";
import { formatFileSize } from "./arcade-games.js";
import { escapeHTML } from "./sponsor-data.js";

const OVERRIDE_ACTIVE_MESSAGE = "Arcade override active until 12:00 AM tonight.";

function describe(status) {
    if (status.reason === "override") return OVERRIDE_ACTIVE_MESSAGE;
    if (!status.open) return "The Arcade is locked for school hours (weekdays 7:30 AM – 2:15 PM). No override is active.";
    return "The Arcade is open. No override is active.";
}

export function mountArcadeTab(container) {
    container.innerHTML = `
        <div class="sponsor-admin">
            <section class="admin-panel">
                <h2 class="member-section-title">ARCADE · SCHOOL-HOURS LOCK</h2>
                <p class="admin-summary" id="arcadeSummary" aria-live="polite">${CHECKING_MESSAGE}</p>
                <form id="arcadeOverrideForm" class="admin-form" autocomplete="off">
                    <label class="admin-form-wide">Override code<input name="code" type="password" maxlength="200" autocomplete="off" required>
                        <small>Unlocks the Arcade for every visitor until 12:00 AM tonight (New York time). It turns off by itself at midnight.</small></label>
                    <div class="admin-actions">
                        <button type="submit" class="btn-approve">UNLOCK FOR TODAY</button>
                        <button type="button" class="btn-neutral" id="arcadeOverrideEnd" hidden>END OVERRIDE</button>
                    </div>
                    <p class="admin-form-status" id="arcadeOverrideStatus" aria-live="polite"></p>
                </form>
            </section>
            <section class="admin-panel">
                <h2 class="member-section-title">ARCADE · PENDING WINDOWS DOWNLOADS</h2>
                <p class="admin-summary">Scan with Windows Defender/VirusTotal before approving.</p>
                <p class="admin-form-status" id="arcadePendingStatus" aria-live="polite"></p>
                <div id="arcadePendingList"><p class="admin-summary">Loading...</p></div>
            </section>
        </div>
    `;

    const summary = container.querySelector("#arcadeSummary");
    const form = container.querySelector("#arcadeOverrideForm");
    const endBtn = container.querySelector("#arcadeOverrideEnd");
    const formStatus = container.querySelector("#arcadeOverrideStatus");
    const setArcadeOverride = httpsCallable(getFunctions(auth.app), "setArcadeOverride");
    let mounted = true;

    const refresh = async () => {
        try {
            const status = await fetchArcadeStatus();
            if (!mounted) return;
            summary.textContent = describe(status);
            endBtn.hidden = status.reason !== "override";
        } catch (error) {
            console.error("Arcade status unavailable:", error);
            if (mounted) summary.textContent = UNREACHABLE_MESSAGE;
        }
    };

    const run = async (data, pending, done) => {
        const buttons = form.querySelectorAll("button");
        buttons.forEach((b) => { b.disabled = true; });
        formStatus.textContent = pending;
        try {
            await setArcadeOverride(data);
            if (!mounted) return;
            formStatus.textContent = done;
            form.elements.code.value = "";
        } catch (error) {
            console.error("Arcade override failed:", error);
            if (mounted) formStatus.textContent = error.message || "Something went wrong. Try again.";
        } finally {
            buttons.forEach((b) => { b.disabled = false; });
            if (mounted) refresh();
        }
    };

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        const code = form.elements.code.value.trim();
        if (!code) return;
        run({ code }, "Checking code...", OVERRIDE_ACTIVE_MESSAGE);
    });

    endBtn.addEventListener("click", () => {
        if (!confirm("End the override? The Arcade will follow the school-hours schedule again.")) return;
        run({ action: "clear" }, "Ending override...", "Override ended.");
    });

    // ---------- PENDING DOWNLOADS ----------

    const pendingList = container.querySelector("#arcadePendingList");
    const pendingStatus = container.querySelector("#arcadePendingStatus");

    const renderPending = (games) => {
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
                    <button type="button" class="btn-approve" data-approve="${escapeHTML(game.id)}">APPROVE</button>
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
            if (res.status === 423) throw new Error("The Arcade is locked for school hours. Use the override above or try after 2:15 PM.");
            if (!res.ok) throw new Error(`The server refused (HTTP ${res.status}).`);
            const { url } = await res.json();
            pendingStatus.textContent = "Download started. Scan it before running it.";
            window.location.assign(url);
        } catch (error) {
            console.error("Review download failed:", error);
            pendingStatus.textContent = error.message || "Could not get the build.";
        }
    };

    const setStatus = async (gameId, status) => {
        pendingStatus.textContent = "Saving...";
        try {
            await update(ref(db, `games/${gameId}`), { status });
            pendingStatus.textContent = status === "approved"
                ? "Approved. It now shows in the Arcade."
                : "Rejected. The author sees it as rejected and can delete it.";
        } catch (error) {
            console.error("Status change failed:", error);
            pendingStatus.textContent = "Could not save. Check that your account is exec or admin.";
        }
    };

    pendingList.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        if (btn.dataset.review) review(btn.dataset.review);
        if (btn.dataset.approve && confirm("Approve this build? Anyone will be able to download it outside school hours.")) {
            setStatus(btn.dataset.approve, "approved");
        }
        if (btn.dataset.reject && confirm("Reject this build?")) setStatus(btn.dataset.reject, "rejected");
    });

    refresh();
    return () => {
        mounted = false;
        stopPending();
    };
}
