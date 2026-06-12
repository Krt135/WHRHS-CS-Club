import { initializeApp, getApps, getApp } from "firebase/app"; 
import { getAuth, onAuthStateChanged, updateProfile, signOut } from "firebase/auth";
import { getDatabase, ref, set, get } from "firebase/database";

// 1. Firebase Config
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "whrhs-cs-club.firebaseapp.com",
  databaseURL: "https://whrhs-cs-club-default-rtdb.firebaseio.com",
  projectId: "whrhs-cs-club",
  storageBucket: "whrhs-cs-club.firebasestorage.app",
  messagingSenderId: "110216471172",
  appId: "1:110216471172:web:53ed19da91c397420258d1"
};

// 🌟 SAFE INITIALIZATION: If an app instance already exists, reuse it. Otherwise, create it.
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getDatabase(app);

// 2. Grab HTML Elements
const largeAvatar = document.getElementById("largeAvatar");
const displayNameHeading = document.getElementById("displayNameHeading");
const headerEmail = document.getElementById("headerEmail");
const headerRole = document.getElementById("headerRole");

const displayNameInput = document.getElementById("displayNameInput");
const emailInput = document.getElementById("emailInput");

const infoRole = document.getElementById("infoRole");
const infoDate = document.getElementById("infoDate");
const infoUid = document.getElementById("infoUid");

const saveBtn = document.getElementById("saveBtn");
const adminBtn = document.getElementById("adminBtn");
const signOutBtn = document.getElementById("signOutBtn");

// 3. Auth Listener & Data Fetcher
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html"; // Kick out if not logged in
        return;
    }

    // Populate basic Auth data
    const name = user.displayName || "";
    const email = user.email || "";
    
    displayNameHeading.textContent = name || email.split('@')[0];
    headerEmail.textContent = email;
    largeAvatar.textContent = (name || email || "?").charAt(0).toUpperCase();
    
    displayNameInput.value = name;
    emailInput.value = email;
    infoUid.textContent = user.uid;

    // Fetch Extra Data (Roles & Join Date) from Realtime Database
    try {
        const userRef = ref(db, `users/${user.uid}`);
        const snapshot = await get(userRef);
        
        if (snapshot.exists()) {
            const data = snapshot.val();
            const role = data.role || "member";
            const joined = data.createdAt || "—";

            // Update UI with DB data
            headerRole.textContent = role.toUpperCase();
            infoRole.textContent = role;
            
            if (joined !== "—") {
                infoDate.textContent = new Date(joined).toLocaleDateString();
            }

            // --- ADMIN BUTTON LOGIC ---
            // If they are an exec or admin, show the button!
            if (role === "exec" || role === "admin") {
                adminBtn.style.display = "inline-flex";
            }
        } else {
            // If they don't exist in the DB yet, create a default profile for them
            const joinDate = new Date().toISOString();
            await set(userRef, {
                email: user.email,
                role: "member",
                createdAt: joinDate
            });
            infoDate.textContent = new Date(joinDate).toLocaleDateString();
        }
    } catch (error) {
        console.error("Error fetching database:", error);
    }
});

// 4. Handle "Save Changes" Button
saveBtn.addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) return;

    const newName = displayNameInput.value.trim();
    saveBtn.textContent = "Saving...";

    try {
        // Update Auth Profile
        await updateProfile(user, { displayName: newName });
        
        // Update Realtime Database
        await set(ref(db, `users/${user.uid}/displayName`), newName);
        
        // Instantly update the visual UI
        displayNameHeading.textContent = newName || user.email.split('@')[0];
        largeAvatar.textContent = (newName || user.email || "?").charAt(0).toUpperCase();
        
        saveBtn.textContent = "Saved!";
        setTimeout(() => saveBtn.textContent = "Save changes →", 2000);
    } catch (error) {
        alert("Error saving: " + error.message);
        saveBtn.textContent = "Save changes →";
    }
});

// 5. Handle "Sign Out"
signOutBtn.addEventListener("click", async () => {
    try {
        await signOut(auth);
        window.location.href = "index.html"; // Go home after logout
    } catch (error) {
        alert("Error signing out.");
    }
});