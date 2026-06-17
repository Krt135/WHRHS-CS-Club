import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "firebase/auth";

import { ref, get, set } from "firebase/database";
import { auth, db } from "./firebase";

// ---------- PROFILE SAVE ----------
async function saveProfile(user, displayName) {
    const userRef = ref(db, "users/" + user.uid);
    const existingProfile = await get(userRef);

    if (existingProfile.exists()) return existingProfile.val();

    await set(ref(db, "users/" + user.uid), {
        uid: user.uid,
        displayName: displayName ?? user.displayName ?? "",
        email: user.email,
        role: "member", 
        status: "pending", 
        photoURL: user.photoURL ?? "",
        createdAt: new Date().toISOString(),
        gamesUploaded: [],
        eventsRegistered: []
    });

    return {
        uid: user.uid,
        displayName: displayName ?? user.displayName ?? "",
        email: user.email,
        role: "member",
        status: "pending",
        photoURL: user.photoURL ?? "",
    };
}

async function requireApprovedMembership(user) {
  const snap = await get(ref(db, "users/" + user.uid));
  const profile = snap.val();

  if (!profile || profile.status !== "approved") {
    await signOut(auth);
    const err = new Error("Your membership request is being processed. You will be able to log in after an exec approves it.");
    err.code = "membership/pending";
    throw err;
  }

  return profile;
}

// ---------- SIGN UP ----------
export async function signUp(email, password, name) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);

  await updateProfile(cred.user, { displayName: name });
  await saveProfile(cred.user, name);
  await signOut(auth);

  return cred.user;
}

// ---------- LOGIN ----------
export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await requireApprovedMembership(cred.user);
  return cred.user;
}

// ---------- GOOGLE ----------
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);

  await saveProfile(cred.user, cred.user.displayName || "User");
  await requireApprovedMembership(cred.user);

  return cred.user;
}

// ---------- AUTH STATE ----------
export function initAuthRedirect() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        await requireApprovedMembership(user);
      } catch (err) {
        return;
      }

      window.location.href = "account.html";
    }
  });
}
