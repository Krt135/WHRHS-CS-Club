// "Help build this website" section on projects.html (#build-the-site).
// Only a repo owner can invite collaborators, so the request is just a
// prefilled email; nothing is stored. Approved, signed-in members see the
// request buttons (mailto, Gmail compose, copy address); everyone else is
// asked to sign in first.
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "firebase/auth";
import { ref, get } from "firebase/database";

// Single source for every request option so mailto and Gmail can't drift.
const REQUEST = {
    email: "cs.whrhs.club@gmail.com",
    subject: "Collaborator access request",
    body: `Hi! I'd like collaborator access to the club website repo.

Name:
GitHub username:
Grade:
What I'd like to work on:
`,
};

const mailtoHref = `mailto:${REQUEST.email}` +
    `?subject=${encodeURIComponent(REQUEST.subject)}` +
    `&body=${encodeURIComponent(REQUEST.body)}`;

// For people whose browser has no mailto handler (most Gmail users).
const gmailHref = "https://mail.google.com/mail/?view=cm&fs=1" +
    `&to=${encodeURIComponent(REQUEST.email)}` +
    `&su=${encodeURIComponent(REQUEST.subject)}` +
    `&body=${encodeURIComponent(REQUEST.body)}`;

async function copyText(text) {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Fall through to the legacy path (e.g. non-secure context).
        }
    }
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    let ok = false;
    try {
        ok = document.execCommand("copy");
    } catch {
        ok = false;
    }
    field.remove();
    return ok;
}

const copyBtn = document.getElementById("requestCopyBtn");
let copyResetTimer;
copyBtn?.addEventListener("click", async () => {
    const ok = await copyText(REQUEST.email);
    copyBtn.textContent = ok ? "Copied" : REQUEST.email;
    clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => { copyBtn.textContent = "Copy email address"; }, 2000);
});

// state: "member" (show the request button), "pending" (account awaiting
// approval), or "guest" (not signed in).
function showRequest(state) {
    const requestBtn = document.getElementById("requestAccessBtn");
    const gmailBtn = document.getElementById("requestGmailBtn");
    const signInPrompt = document.getElementById("requestSignIn");
    const pendingNote = document.getElementById("requestPending");
    if (!requestBtn || !signInPrompt || !pendingNote) return;

    requestBtn.href = mailtoHref;
    for (const el of [requestBtn, gmailBtn, copyBtn]) {
        if (el) el.hidden = state !== "member";
    }
    if (gmailBtn) gmailBtn.href = gmailHref;
    signInPrompt.hidden = state !== "guest";
    pendingNote.hidden = state !== "pending";
}

onAuthStateChanged(auth, async (user) => {
    if (!user) return showRequest("guest");
    try {
        const profile = (await get(ref(db, `users/${user.uid}`))).val() || {};
        const isMember = profile.status === "approved" || ["exec", "admin"].includes(profile.role);
        showRequest(isMember ? "member" : "pending");
    } catch (error) {
        // The request is only an email, so fail open rather than block a member.
        console.error("Unable to check membership for collaborator requests:", error);
        showRequest("member");
    }
});
