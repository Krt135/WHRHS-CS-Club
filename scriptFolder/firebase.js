import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "whrhs-cs-club.firebaseapp.com",
  databaseURL: "https://whrhs-cs-club-default-rtdb.firebaseio.com",
  projectId: "whrhs-cs-club",
  storageBucket: "whrhs-cs-club.firebasestorage.app",
  messagingSenderId: "110216471172",
  appId: "1:110216471172:web:53ed19da91c397420258d1",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);