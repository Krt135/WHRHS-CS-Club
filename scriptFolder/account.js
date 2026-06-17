import { initializeApp, getApps, getApp } from "firebase/app"; 
import { getAuth, onAuthStateChanged, updateProfile, signOut, updateEmail } from "firebase/auth";
import { getDatabase, ref, set, get, update } from "firebase/database"; // 🌟 Added update here

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

const bioInput = document.getElementById("bioInput");
const phoneInput = document.getElementById("phoneInput");

// 3. Auth Listener & Data Fetcher
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html"; 
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

    try {
        const userRef = ref(db, `users/${user.uid}`);
        const snapshot = await get(userRef);
        
        if (snapshot.exists()) {
            const data = snapshot.val();
            
            // 🌟 FIX 3: Kick out pending users back to homepage
            if (data.status === "pending") {
                alert("Your membership application is currently pending review by the Exec Board.");
                window.location.href = "index.html";
                return;
            }

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
                if (adminBtn) adminBtn.style.display = "inline-flex";
                if (emailInput) emailInput.disabled = false; 
        
                const helpText = document.querySelector(".help-text");
                if (helpText) helpText.textContent = "As an exec, you can update your official routing email.";
            }
        } else {
            // 🌟 FIX 1: Use safe defaults ONLY if user has no record at all in database
            const joinDate = new Date().toISOString();
            await set(userRef, {
                uid: user.uid,
                displayName: name,
                email: user.email,
                role: "member",
                status: "approved", // Existing old users default to approved
                createdAt: joinDate,
                gamesUploaded: [],
                eventsRegistered: []
            });
            infoDate.textContent = new Date(joinDate).toLocaleDateString();
            headerRole.textContent = "MEMBER";
            infoRole.textContent = "member";
        }
    } catch (error) {
        console.error("Error fetching database:", error);
    }
});

// 🌟 FIX 2: Link the Admin Button up to navigate to admin.html
if (adminBtn) {
    adminBtn.addEventListener("click", () => {
        window.location.href = "admin.html";
    });
}

// 4. Handle "Save Changes" Button
saveBtn.addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) return;

    const newName = displayNameInput.value.trim();
    const newEmail = emailInput.value.trim();
    const newBio = bioInput.value.trim();
    const newPhone = phoneInput.value.trim();
    
    saveBtn.textContent = "Saving...";
    saveBtn.disabled = true;

    try {
        // Update Firebase Auth structural profile if display name changed
        if (newName !== user.displayName) {
            await updateProfile(user, { displayName: newName });
        }
        
        // Update Auth core account email routing if changed
        if (newEmail && newEmail !== user.email) {
            await updateEmail(user, newEmail);
            headerEmail.textContent = newEmail;
        }

        // 🌟 Use update() to save data node properties selectively without destroying others
        await update(ref(db, `users/${user.uid}`), {
            displayName: newName,
            email: newEmail,
            bio: newBio,
            phone: newPhone
        });
        
        // Update layout presentation headers
        displayNameHeading.textContent = newName || newEmail.split('@')[0];
        largeAvatar.textContent = (newName || newEmail || "?").charAt(0).toUpperCase();
        
        saveBtn.textContent = "Saved!";
        setTimeout(() => {
            saveBtn.textContent = "Save changes →";
            saveBtn.disabled = false;
        }, 2000);

    } catch (error) {
        console.error("Error updating profile:", error);
        if (error.code === "auth/requires-recent-login") {
            alert("Security measure: Changing credentials requires a fresh login session. Please log out, sign back in, and retry.");
        } else {
            alert("Error saving properties: " + error.message);
        }
        saveBtn.textContent = "Save changes →";
        saveBtn.disabled = false;
    }
});

// 5. Handle "Sign Out"
signOutBtn.addEventListener("click", async () => {
    try {
        await signOut(auth);
        window.location.href = "index.html";
    } catch (error) {
        alert("Error signing out.");
    }
});