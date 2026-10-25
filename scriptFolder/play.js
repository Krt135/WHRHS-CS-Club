import { auth, db, storage } from "./firebase.js";
import { onAuthStateChanged } from "firebase/auth";
import { ref as dbRef, get, update } from "firebase/database";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { showSponsorSplash } from "./sponsor-splash.js";
import { arcadeGameUrl, fetchArcadeStatus, CHECKING_MESSAGE, LOCK_MESSAGE, UNREACHABLE_MESSAGE } from "./arcade-lock.js";
import { engineLabel, gameFormat, isHttpsUrl } from "./arcade-games.js";
import { DETAIL_FIELDS, attachCounter, cleanDetails, coverPath, isCoverUrl, prepareCover, renderDetails } from "./game-details.js";

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Grab target system coordinates out of routing query array
    const urlParams = new URLSearchParams(window.location.search);
    const gameId = urlParams.get("id");

    const titleEl = document.getElementById("gameTitle");
    const authorEl = document.getElementById("gameAuthor");
    const engineTagEl = document.getElementById("gameEngineTag");
    const viewport = document.getElementById("arcadeViewport");
    const statusScreen = document.getElementById("engineStatusScreen");
    const statusMessage = document.getElementById("statusMessage");
    const statusSpinner = statusScreen?.querySelector(".play-status-spinner");

    if (!gameId) {
        if (titleEl) titleEl.innerText = "Error: Missing Project Link Pointer";
        if (statusMessage) statusMessage.innerText = "Fatal: Execution aborted due to null ID parameters.";
        return;
    }

    // Leaves the status screen up over an empty viewport with a message.
    const showBlocked = (message) => {
        if (statusSpinner) statusSpinner.hidden = true;
        if (statusMessage) statusMessage.innerText = message;
        if (engineTagEl) engineTagEl.innerText = "ARCADE LOCKED";
    };

    try {
        // 2. Ask the server whether the Arcade is open while the game's
        // details load. The server refuses the game files when it's locked;
        // this check just explains why instead of showing a broken frame.
        statusMessage.innerText = CHECKING_MESSAGE;
        const [status, projectSnap] = await Promise.all([
            fetchArcadeStatus().catch((err) => {
                console.error("Arcade status unavailable:", err);
                return null;
            }),
            get(dbRef(db, `games/${gameId}`)),
        ]);

        if (!projectSnap.exists()) {
            throw new Error("Target cluster data array has expired or does not exist.");
        }

        const projectData = projectSnap.val();

        // 3. Update view templates with raw text details
        titleEl.innerText = projectData.title;
        authorEl.innerText = `Published by: ${projectData.authorName || "Anonymous Member"}`;
        engineTagEl.innerText = `${engineLabel(projectData.engine)} // ${projectData.category === "group" ? "Group Build" : "Solo Project"}`;
        // About / Credits / Known bugs: text only, shown even while locked.
        renderDetails(document.getElementById("gameDetails"), projectData);
        setUpDetailsEditing(gameId, projectData);

        // Windows download builds aren't playable in the browser.
        if (gameFormat(projectData) === "download") {
            if (statusSpinner) statusSpinner.hidden = true;
            statusMessage.innerText = "This game is a Windows download. Get it from the Arcade on the Projects page.";
            return;
        }

        if (!status) return showBlocked(UNREACHABLE_MESSAGE);
        if (!status.open) return showBlocked(LOCK_MESSAGE);

        const isWebgl = gameFormat(projectData) === "webgl";
        if (!isWebgl && !isHttpsUrl(projectData.embedUrl)) {
            if (statusSpinner) statusSpinner.hidden = true;
            statusMessage.innerText = "This game's link is invalid.";
            return;
        }

        // 4. Load the game. Uploaded builds come from the arcade function
        // (its own origin, lock checked on every file); external links load
        // as-is, since another site can't be locked from here.
        statusMessage.innerText = "Connecting secure asset stream path...";
        showSponsorSplash(document.querySelector(".play-viewport-container"));

        viewport.addEventListener("load", () => {
            if (statusScreen) statusScreen.style.display = "none";
        }, { once: true });
        viewport.src = isWebgl ? arcadeGameUrl(gameId) : projectData.embedUrl;

    } catch (error) {
        console.error(error);
        if (titleEl) titleEl.innerText = "Runtime Exception Detected";
        if (statusMessage) statusMessage.innerText = `Error Log: ${error.message}`;
    }
});

// ─── EDIT DETAILS ────────────────────────────────────────────────────
// The owner (and exec/admin) can change About, Credits, Known bugs and the
// cover. The database rules only let an owner change those four fields on
// an existing record (status, format, title... stay as they are), and
// Storage only lets the owner write covers/{uid}/, so execs editing
// someone else's game get the text fields only.
function setUpDetailsEditing(gameId, initialGame) {
    const openBtn = document.getElementById("editDetailsBtn");
    const dialog = document.getElementById("editDetailsDialog");
    const form = document.getElementById("editDetailsForm");
    if (!openBtn || !dialog || !form) return;

    const fields = {};
    const counters = [];
    for (const { key, max } of DETAIL_FIELDS) {
        const textarea = form.querySelector(`[data-detail="${key}"]`);
        fields[key] = textarea;
        const counter = document.getElementById(textarea.getAttribute("aria-describedby"));
        counters.push(attachCounter(textarea, counter, max));
    }
    const coverGroup = document.getElementById("editCoverGroup");
    const coverInput = document.getElementById("editCover");
    const coverPreview = document.getElementById("editCoverPreview");
    const coverError = document.getElementById("editCoverError");
    const removeCover = document.getElementById("editRemoveCover");
    const removeCoverLabel = document.getElementById("editRemoveCoverLabel");
    const status = document.getElementById("editStatus");
    const saveBtn = document.getElementById("editSave");

    let game = initialGame;
    let user = null;
    let pendingCover = null;
    const isOwner = () => Boolean(user && user.uid === game.authorUid);

    const clearPreview = () => {
        if (pendingCover) URL.revokeObjectURL(pendingCover.previewUrl);
        pendingCover = null;
        coverPreview.hidden = true;
        coverPreview.removeAttribute("src");
        coverError.textContent = "";
    };
    const clearCover = () => {
        clearPreview();
        coverInput.value = "";
    };

    onAuthStateChanged(auth, async (signedIn) => {
        user = signedIn;
        let role = null;
        if (signedIn) {
            try {
                role = (await get(dbRef(db, `users/${signedIn.uid}/role`))).val();
            } catch (error) {
                console.error("Role lookup failed:", error);
            }
        }
        openBtn.hidden = !(isOwner() || role === "exec" || role === "admin");
    });

    openBtn.addEventListener("click", () => {
        for (const { key } of DETAIL_FIELDS) fields[key].value = game[key] || "";
        counters.forEach((refresh) => refresh());
        clearCover();
        removeCover.checked = false;
        coverGroup.hidden = !isOwner();
        removeCoverLabel.hidden = !isCoverUrl(game.coverUrl, game.authorUid, gameId);
        status.textContent = "";
        dialog.showModal();
    });

    document.getElementById("editCancel").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", clearCover);

    coverInput.addEventListener("change", async () => {
        clearPreview();
        const file = coverInput.files[0];
        if (!file) return;
        try {
            pendingCover = await prepareCover(file);
            coverPreview.src = pendingCover.previewUrl;
            coverPreview.hidden = false;
            removeCover.checked = false;
        } catch (error) {
            coverInput.value = "";
            coverError.textContent = error.message;
        }
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        saveBtn.disabled = true;
        status.textContent = "Saving...";
        try {
            // null removes a field, so cleared textareas leave the record.
            const changes = cleanDetails(Object.fromEntries(
                Object.entries(fields).map(([key, el]) => [key, el.value])));
            let deleteOldCover = false;
            if (isOwner() && removeCover.checked) {
                changes.coverUrl = null;
                deleteOldCover = true;
            } else if (isOwner() && pendingCover) {
                status.textContent = "Uploading cover image...";
                const ref = storageRef(storage, coverPath(game.authorUid, gameId));
                await uploadBytes(ref, pendingCover.blob, { contentType: "image/webp" });
                // Same object, new bytes: the query string makes cards and
                // browsers fetch the new image instead of a cached one.
                changes.coverUrl = `${await getDownloadURL(ref)}&v=${Date.now()}`;
            }

            await update(dbRef(db, `games/${gameId}`), changes);
            if (deleteOldCover) {
                await deleteObject(storageRef(storage, coverPath(game.authorUid, gameId)))
                    .catch((error) => console.warn("Old cover not deleted:", error));
            }

            game = { ...game };
            for (const [key, value] of Object.entries(changes)) {
                if (value === null) delete game[key];
                else game[key] = value;
            }
            renderDetails(document.getElementById("gameDetails"), game);
            dialog.close();
        } catch (error) {
            console.error("Saving details failed:", error);
            status.textContent = `Couldn't save: ${error.message}`;
        } finally {
            saveBtn.disabled = false;
        }
    });
}
