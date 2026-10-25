import { db } from "./firebase.js";
import { ref as dbRef, get } from "firebase/database";
import { showSponsorSplash } from "./sponsor-splash.js";
import { arcadeGameUrl, fetchArcadeStatus, CHECKING_MESSAGE, LOCK_MESSAGE, UNREACHABLE_MESSAGE } from "./arcade-lock.js";
import { engineLabel, gameFormat, isHttpsUrl } from "./arcade-games.js";
import { renderDetails } from "./game-details.js";

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
