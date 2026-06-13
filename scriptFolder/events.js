import { initializeApp, getApps, getApp } from "firebase/app"; 
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getDatabase, ref, get, set, push, onValue, remove } from "firebase/database"; // 🌟 Added remove!

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
const addCompBtn = document.getElementById("addCompBtn");
const compModal = document.getElementById("compModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const saveCompBtn = document.getElementById("saveCompBtn");
const compListContainer = document.getElementById("compListContainer");

const nameInput = document.getElementById("compNameInput");
const dateInput = document.getElementById("compDateInput");
const resultInput = document.getElementById("compResultInput");

// Deletion Elements
const deleteModal = document.getElementById("deleteModal");
const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
const closeDeleteModalBtn = document.getElementById("closeDeleteModalBtn");

let itemToDeleteId = null; // Temporary holding variable for the target entry

// 3. Security Check
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userRef = ref(db, `users/${user.uid}/role`);
        const snapshot = await get(userRef);
        
        if (snapshot.exists()) {
            const role = snapshot.val();
            if (role === "exec" || role === "admin") {
                addCompBtn.style.display = "inline-flex";
                document.body.classList.add("user-is-exec"); // 🌟 Activates the trash icons via CSS
            }
        }
    }
});

// 4. Creation Modal Triggers
addCompBtn.addEventListener("click", () => compModal.style.display = "flex");
closeModalBtn.addEventListener("click", () => {
    compModal.style.display = "none";
    nameInput.value = ""; dateInput.value = ""; resultInput.value = "";
});

// 5. Save Data to Database
saveCompBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const date = dateInput.value.trim();
    const result = resultInput.value.trim();

    if (!name || !date || !result) return alert("Please fill out all fields.");

    saveCompBtn.textContent = "Saving...";
    saveCompBtn.disabled = true;

    try {
        const newCompRef = push(ref(db, 'competitions'));
        await set(newCompRef, { name, date, result, timestamp: Date.now() });
        compModal.style.display = "none";
        nameInput.value = ""; dateInput.value = ""; resultInput.value = "";
    } catch (error) {
        alert("Error saving: " + error.message);
    }
    saveCompBtn.textContent = "Save to list";
    saveCompBtn.disabled = false;
});

// 6. Realtime Sync & UI Renderer
onValue(ref(db, 'competitions'), (snapshot) => {
    let combinedHtml = "";
    
    if (snapshot.exists()) {
        // Collect rows and sort them newest first by timestamp
        const records = [];
        snapshot.forEach((childSnapshot) => {
            records.push({
                id: childSnapshot.key, // Grab the unique firebase entry string ID
                ...childSnapshot.val()
            });
        });
        
        records.sort((a, b) => b.timestamp - a.timestamp);

        records.forEach(comp => {
            combinedHtml += `
              <div class="comp-row">
                <span class="comp-col-name comp-name">${comp.name}</span>
                <span class="comp-col-period comp-period">${comp.date}</span>
                <span class="comp-col-result comp-result">${comp.result}</span>
                <button class="delete-btn" data-id="${comp.id}" title="Delete entry">✕</button>
              </div>
            `;
        });
    } else {
        combinedHtml = `<p class="font-mono" style="color: var(--muted-fg); padding: 16px 0;">No competition logs on record.</p>`;
    }
    
    compListContainer.innerHTML = combinedHtml;
});

// 7. Event Delegation: Listen for dynamic trash clicks
compListContainer.addEventListener("click", (e) => {
    const deleteBtn = e.target.closest(".delete-btn");
    if (!deleteBtn) return;

    // Track the target firebase item key and deploy modal
    itemToDeleteId = deleteBtn.getAttribute("data-id");
    deleteModal.style.display = "flex";
});

// 8. Execute Deletion Command
confirmDeleteBtn.addEventListener("click", async () => {
    if (!itemToDeleteId) return;
    
    confirmDeleteBtn.textContent = "Deleting...";
    confirmDeleteBtn.disabled = true;

    try {
        // Purge the specific item record key from the cloud database node
        await remove(ref(db, `competitions/${itemToDeleteId}`));
        deleteModal.style.display = "none";
    } catch (error) {
        alert("Permission error: " + error.message);
    }

    itemToDeleteId = null;
    confirmDeleteBtn.textContent = "Yes";
    confirmDeleteBtn.disabled = false;
});

// Dismiss Deletion Modal
closeDeleteModalBtn.addEventListener("click", () => {
    deleteModal.style.display = "none";
    itemToDeleteId = null;
});