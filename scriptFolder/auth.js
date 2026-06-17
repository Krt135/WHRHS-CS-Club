import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged
} from "firebase/auth";

import { ref, set } from "firebase/database";
import { auth, db } from "./firebase";

// ---------- PROFILE SAVE ----------
async function saveProfile(user, displayName) {
    await set(ref(db, "users/" + user.uid), {
        uid: user.uid,
        displayName: displayName ?? user.displayName ?? "",
        email: user.email,
        role: "member", 
        status: "pending", 
        photoURL: user.photoURL ?? "",
        gamesUploaded: [],
        eventsRegistered: []
    });
}

// ---------- SIGN UP ----------
export async function signUp(email, password, name) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);

  await updateProfile(cred.user, { displayName: name });
  await saveProfile(cred.user, name);

  return cred.user;
}

// ---------- LOGIN ----------
export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// ---------- GOOGLE ----------
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);

  await saveProfile(cred.user, cred.user.displayName || "User");

  return cred.user;
}

// ---------- AUTH STATE ----------
export function initAuthRedirect() {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      window.location.href = "account.html";
    }
  });
}