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
        
        if (projectData.embedUrl) {
            // Fetch raw HTML text manually to bypass Supabase's strict CSP sandbox headers
            fetch(projectData.embedUrl)
                .then(response => {
                    if (!response.ok) throw new Error("Failed to download game assets.");
                    return response.text();
                })
                .then(htmlContent => {
                    // Extract the clean base directory path of the deployed folder assets
                    const baseDir = projectData.embedUrl.substring(0, projectData.embedUrl.lastIndexOf('/')) + '/';
                    
                    // Inject a <base> tag so relative paths (like script src="game.js") trace correctly
                    let injectedHtml = htmlContent;
                    if (htmlContent.includes('<head>')) {
                        injectedHtml = htmlContent.replace('<head>', `<head><base href="${baseDir}">`);
                    } else if (htmlContent.includes('<HEAD>')) {
                        injectedHtml = htmlContent.replace('<HEAD>', `<HEAD><base href="${baseDir}">`);
                    } else {
                        injectedHtml = `<base href="${baseDir}">` + htmlContent;
                    }
                    
                    // Open and write directly to the iframe context stream
                    const iframeDoc = viewport.contentWindow.document || viewport.contentDocument;
                    iframeDoc.open();
                    iframeDoc.write(injectedHtml);
                    iframeDoc.close();

                    // Instantly drop the loading screen curtain now that the code assets are written
                    if (statusScreen) statusScreen.style.display = "none";
                })
                .catch(err => {
                    console.error("Arcade Content Injection Fallback Triggered:", err);
                    
                    // Failover logic: if the direct fetch is blocked, default back to standard src mapping
                    viewport.addEventListener("load", () => {
                        if (statusScreen) statusScreen.style.display = "none";
                    });
                    viewport.src = projectData.embedUrl;
                });
        }

    } catch (error) {
        console.error(error);
        if (titleEl) titleEl.innerText = "Runtime Exception Detected";
        if (statusMessage) statusMessage.innerText = `Error Log: ${error.message}`;
    }
});