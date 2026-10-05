// "Help build this website" section on projects.html (#build-the-site).
// Only a repo owner can invite collaborators, so the request is just a
// prefilled email; nothing is stored. Approved, signed-in members see the
// request button; everyone else is asked to sign in first.
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "firebase/auth";
import { ref, get } from "firebase/database";

const REQUEST_EMAIL = "cs.whrhs.club@gmail.com";
const REQUEST_SUBJECT = "Collaborator access request";
const REQUEST_BODY = `Hi! I'd like collaborator access to the club website repo.

Name:
GitHub username:
Grade:
What I'd like to work on:
`;

const requestHref = `mailto:${REQUEST_EMAIL}` +
    `?subject=${encodeURIComponent(REQUEST_SUBJECT)}` +
    `&body=${encodeURIComponent(REQUEST_BODY)}`;

// state: "member" (show the request button), "pending" (account awaiting
// approval), or "guest" (not signed in).
function showRequest(state) {
    const requestBtn = document.getElementById("requestAccessBtn");
    const signInPrompt = document.getElementById("requestSignIn");
    const pendingNote = document.getElementById("requestPending");
    if (!requestBtn || !signInPrompt || !pendingNote) return;

    requestBtn.href = requestHref;
    requestBtn.hidden = state !== "member";
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
