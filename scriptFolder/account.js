import { initializeApp, getApps, getApp } from "firebase/app"; 
import { getAuth, onAuthStateChanged, updateProfile, signOut } from "firebase/auth";
import { getDatabase, ref, set, get } from "firebase/database";
import { updateEmail } from "firebase/auth";

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
const emailEdit = document.getElementById("emailInput");

const bioInput = document.getElementById("bioInput");
const phoneInput = document.getElementById("phoneInput");

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

            const bio = data.bio || "";
            const phone = data.phone || "";
            if (bioInput) bioInput.value = bio;
            if (phoneInput) phoneInput.value = phone;

            // Update UI with DB data
            headerRole.textContent = role.toUpperCase();
            infoRole.textContent = role;
            
            if (joined !== "—") {
                infoDate.textContent = new Date(joined).toLocaleDateString();
            }

            // --- EXEC / ADMIN PRIVILEGES ---
        if (role === "exec" || role === "admin") {
            adminBtn.style.display = "inline-flex";
    
    // Enable the input field so they can type inside it
            emailInput.disabled = false; 
    
    // Optional: Hide or change the helper warning text if you want
            const helpText = document.querySelector(".help-text");
            if (helpText) helpText.textContent = "As an exec, you can update your official routing email.";
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
    const newEmail = emailInput.value.trim();
    
    // --- NEW: Grab the bio and phone values ---
    const newBio = bioInput.value.trim();
    const newPhone = phoneInput.value.trim();
    
    saveBtn.textContent = "Saving...";
    saveBtn.disabled = true;

    try {
        // 1. Update Display Name if it changed
        if (newName !== user.displayName) {
            await updateProfile(user, { displayName: newName });
            await set(ref(db, `users/${user.uid}/displayName`), newName);
        }
        
        // 2. Update Email if it changed
        if (newEmail && newEmail !== user.email) {
            await updateEmail(user, newEmail);
            await set(ref(db, `users/${user.uid}/email`), newEmail);
            headerEmail.textContent = newEmail;
        }

        // --- NEW: 3. Save Bio and Phone to the Database ---
        await set(ref(db, `users/${user.uid}/bio`), newBio);
        await set(ref(db, `users/${user.uid}/phone`), newPhone);
        
        // 4. Update top heading name layout
        displayNameHeading.textContent = newName || newEmail.split('@')[0];
        largeAvatar.textContent = (newName || newEmail || "?").charAt(0).toUpperCase();
        
        saveBtn.textContent = "Saved!";
        setTimeout(() => {
            saveBtn.textContent = "Save changes →";
            saveBtn.disabled = false;
        }, 2000);

    } catch (error) {
        console.error("Error updating profile:", error);
        
        // Handle security re-authentication requirements
        if (error.code === "auth/requires-recent-login") {
            alert("Security measure: Changing an email requires a fresh login. Please sign out, sign back in, and try again.");
        } else {
            alert("Error saving: " + error.message);
        }
        
        saveBtn.textContent = "Save changes →";
        saveBtn.disabled = false;
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