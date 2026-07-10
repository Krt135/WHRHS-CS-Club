import { initializeApp, getApps, getApp } from "firebase/app"; 
import { getAuth, onAuthStateChanged, updateProfile, signOut, updateEmail } from "firebase/auth";
import { getDatabase, ref, set, get, update } from "firebase/database"; 

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

    try {
        // 🔒 SECURITY CHECK: Always look up the currently logged-in browser session user first
        const currentUserRef = ref(db, `users/${user.uid}`);
        const currentUserSnapshot = await get(currentUserRef);
        
        let loggedInUserRole = "member";
        if (currentUserSnapshot.exists()) {
            const currentUserData = currentUserSnapshot.val();
            
            // Kick out pending users immediately
            if (currentUserData.status === "pending") {
                alert("Your membership application is currently pending review by the Exec Board.");
                window.location.href = "index.html";
                return;
            }
            loggedInUserRole = currentUserData.role || "member";
        }

        // 🌐 URL ROUTING CHECK: Are we looking at ourselves or a shared link?
        const urlParams = new URLSearchParams(window.location.search);
        const targetUid = urlParams.get('user');
        const isOwnProfile = !targetUid || targetUid === user.uid;

        if (isOwnProfile) {
            // ==========================================
            // 📝 MODE A: EDIT MODE (OWN PROFILE)
            // ==========================================
            if (saveBtn) saveBtn.style.display = "inline-flex";
            displayNameInput.disabled = false;
            emailInput.disabled = true; // Kept default disabled unless authorized as Exec below
            if (bioInput) bioInput.disabled = false;
            if (phoneInput) phoneInput.disabled = false;

            const name = user.displayName || "";
            const email = user.email || "";
            
            displayNameHeading.textContent = name || email.split('@')[0];
            headerEmail.textContent = email;
            largeAvatar.textContent = (name || email || "?").charAt(0).toUpperCase();
            
            displayNameInput.value = name;
            emailInput.value = email;
            infoUid.textContent = user.uid;

            if (currentUserSnapshot.exists()) {
                const data = currentUserSnapshot.val();
                const role = data.role || "member";
                const joined = data.createdAt || "—";
                const bio = data.bio || "";
                const phone = data.phone || "";
                
                if (bioInput) bioInput.value = bio;
                if (phoneInput) phoneInput.value = phone;

                headerRole.textContent = role.toUpperCase();
                infoRole.textContent = role;
                
                if (joined !== "—") {
                    infoDate.textContent = new Date(joined).toLocaleDateString();
                }

                // Show Admin panel privileges ONLY if you are an authorized Exec viewing your OWN profile
                if (role === "exec" || role === "admin") {
                    if (adminBtn) adminBtn.style.display = "inline-flex";
                    if (emailInput) emailInput.disabled = false; 
            
                    const helpText = document.querySelector(".help-text");
                    if (helpText) helpText.textContent = "As an exec, you can update your official routing email.";
                } else {
                    if (adminBtn) adminBtn.style.display = "none";
                }
            } else {
                // Initialize safe defaults for completely fresh database records
                const joinDate = new Date().toISOString();
                await set(currentUserRef, {
                    uid: user.uid,
                    displayName: name,
                    email: user.email,
                    role: "member",
                    status: "pending", 
                    createdAt: joinDate,
                    gamesUploaded: [],
                    eventsRegistered: []
                });
                infoDate.textContent = new Date(joinDate).toLocaleDateString();
                headerRole.textContent = "MEMBER";
                infoRole.textContent = "member";
                if (adminBtn) adminBtn.style.display = "none";
            }

        } else {
            // ==========================================
            // 🔒 MODE B: VIEW-ONLY MODE (VISITOR PROFILE)
            // ==========================================
            // 1. Instantly hide sensitive actions and layout panels
            if (saveBtn) saveBtn.style.display = "none";
            if (adminBtn) adminBtn.style.display = "none";
            if (signOutBtn) signOutBtn.style.display = "none";
            
            // 2. Lockdown form controls so visitors cannot rewrite the values
            displayNameInput.disabled = true;
            emailInput.disabled = true;
            if (bioInput) bioInput.disabled = true;
            if (phoneInput) phoneInput.disabled = true;

            // 3. Clear/Override context instruction labels
            const helpText = document.querySelector(".help-text");
            if (helpText) helpText.textContent = "You are viewing another club member's profile.";

            // 4. Pull down the target user's records from the database
            const targetUserRef = ref(db, `users/${targetUid}`);
            const targetSnapshot = await get(targetUserRef);

            if (targetSnapshot.exists()) {
                const targetData = targetSnapshot.val();
                
                const targetName = targetData.displayName || "";
                const targetEmail = targetData.email || "";
                const targetRole = targetData.role || "member";
                const targetJoined = targetData.createdAt || "—";
                const targetBio = targetData.metaBio || targetData.bio || "";
                const targetPhone = targetData.phone || "";

                // 5. Swap out screen components to reflect the target user's details
                displayNameHeading.textContent = targetName || targetEmail.split('@')[0];
                headerEmail.textContent = targetEmail;
                largeAvatar.textContent = (targetName || targetEmail || "?").charAt(0).toUpperCase();
                
                displayNameInput.value = targetName;
                emailInput.value = targetEmail;
                if (bioInput) bioInput.value = targetBio;
                if (phoneInput) phoneInput.value = targetPhone;
                infoUid.textContent = targetUid;

                headerRole.textContent = targetRole.toUpperCase();
                infoRole.textContent = targetRole;
                
                if (targetJoined !== "—") {
                    infoDate.textContent = new Date(targetJoined).toLocaleDateString();
                }
            } else {
                alert("The selected club profile could not be found.");
                window.location.href = "projects.html";
            }
        }
    } catch (error) {
        console.error("Error loading account node hierarchy:", error);
    }
});

// 4. Link the Admin Button up to navigate to admin.html
if (adminBtn) {
    adminBtn.addEventListener("click", () => {
        window.location.href = "admin.html";
    });
}

// 5. Handle "Save Changes" Button
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
        if (newName !== user.displayName) {
            await updateProfile(user, { displayName: newName });
        }
        
        if (newEmail && newEmail !== user.email) {
            await updateEmail(user, newEmail);
            headerEmail.textContent = newEmail;
        }

        await update(ref(db, `users/${user.uid}`), {
            displayName: newName,
            email: newEmail,
            bio: newBio,
            phone: newPhone
        });
        
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

// 6. Handle "Sign Out"
signOutBtn.addEventListener("click", async () => {
    try {
        await signOut(auth);
        window.location.href = "index.html";
    } catch (error) {
        alert("Error signing out.");
    }
});