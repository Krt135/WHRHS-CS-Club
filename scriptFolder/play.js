import { db } from "./firebase.js";
import { ref as dbRef, get } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-database.js";

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

    if (!gameId) {
        if (titleEl) titleEl.innerText = "Error: Missing Project Link Pointer";
        if (statusMessage) statusMessage.innerText = "Fatal: Execution aborted due to null ID parameters.";
        return;
    }

    try {
        // 2. Fetch specific records matching key signature directly out of Firebase tree
        statusMessage.innerText = "Querying live database architecture...";
        
        // 🌟 FIXED PATH: Changed from 'projects/' to 'games/' to match your database schema
        const projectSnap = await get(dbRef(db, `games/${gameId}`));

        if (!projectSnap.exists()) {
            throw new Error("Target cluster data array has expired or does not exist.");
        }

        const projectData = projectSnap.val();

        // 3. Update view templates with raw text details
        titleEl.innerText = projectData.title;
        authorEl.innerText = `Published by: ${projectData.authorName || "Anonymous Member"}`;
        engineTagEl.innerText = `${projectData.engine || "HTML5 Web Engine"} // ${projectData.category === "group" ? "Group Build" : "Solo Project"}`;

        // 4. Inject verified tracking asset destination endpoint URL directly into secure frame element
        statusMessage.innerText = "Connecting secure asset stream path...";
        
        // Listen for when iframe finishes loading to safely fade out status curtain
        viewport.addEventListener("load", () => {
            if (statusScreen) statusScreen.style.display = "none";
        });

        viewport.src = projectData.embedUrl;

    } catch (error) {
        console.error(error);
        if (titleEl) titleEl.innerText = "Runtime Exception Detected";
        if (statusMessage) statusMessage.innerText = `Error Log: ${error.message}`;
    }
});