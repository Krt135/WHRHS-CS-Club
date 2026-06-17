import { initializeApp } from "firebase/app";
import {
    getAuth,
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    updateProfile,
    GoogleAuthProvider,
    signInWithPopup
} from "firebase/auth";
import {
    getDatabase,
    ref,
    set,
    serverTimestamp
} from "firebase/database";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY, 
  authDomain: "whrhs-cs-club.firebaseapp.com",
  databaseURL: "https://whrhs-cs-club-default-rtdb.firebaseio.com",
  projectId: "whrhs-cs-club",
  storageBucket: "whrhs-cs-club.firebasestorage.app",
  messagingSenderId: "110216471172",
  appId: "1:110216471172:web:53ed19da91c397420258d1",
  measurementId: "G-ZYQZXSNML0"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

// Redirect already-logged-in users
//onAuthStateChanged(auth, user => {
  //  if (user) window.location.href = "index.html";
//});

// Saves a user profile doc in Firestore under /users/{uid}
async function saveProfile(user, displayName) {
    await set(ref(db, "users/" + user.uid), {
        uid:              user.uid,
        displayName:      displayName ?? user.displayName ?? "",
        email:            user.email,
        photoURL:         user.photoURL ?? "",
        gamesUploaded:    [],
        eventsRegistered: []
    });
}

// ── Feedback helpers ──────────────────────────────────────────────────────────
function showFeedback(msg, isError = true) {
    const el = document.getElementById("signUpFeedback");
    el.textContent = msg;
    el.className = "auth-feedback " + (isError ? "error" : "success");
    el.hidden = false;
}
function clearFeedback() {
    const el = document.getElementById("signUpFeedback");
    el.hidden = true;
    el.textContent = "";
}

function friendlyError(code) {
    const map = {
        "auth/email-already-in-use": "An account with that email already exists.",
        "auth/invalid-email":        "That doesn't look like a valid email.",
        "auth/weak-password":        "Password must be at least 6 characters."
    };
    return map[code] ?? "Something went wrong. Please try again.";
}

// ── Email / Password sign-up ──────────────────────────────────────────────────
document.getElementById("signUpForm").addEventListener("submit", async e => {
    e.preventDefault();
    clearFeedback();

    const name     = document.getElementById("signUpName").value.trim();
    const email    = document.getElementById("signUpEmail").value.trim();
    const password = document.getElementById("signUpPassword").value;
    const confirm  = document.getElementById("signUpConfirm").value;

    if (!name)                  return showFeedback("Please enter a display name.");
    if (password !== confirm)   return showFeedback("Passwords don't match.");
    if (password.length < 6)    return showFeedback("Password must be at least 6 characters.");

    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name });
        await saveProfile(cred.user, name);
        // onAuthStateChanged will redirect to index.html
    } catch (err) {
        showFeedback(friendlyError(err.code));
    }
});

// ── Google Sign-Up ────────────────────────────────────────────────────────────
document.getElementById("googleSignUpBtn").addEventListener("click", async () => {
    clearFeedback();
    try {
        const provider = new GoogleAuthProvider();
        const cred     = await signInWithPopup(auth, provider);
        await saveProfile(cred.user, cred.user.displayName);
        // onAuthStateChanged will redirect
    } catch (err) {
        if (err.code !== "auth/popup-closed-by-user") {
            showFeedback(friendlyError(err.code));
        }
    }
});
