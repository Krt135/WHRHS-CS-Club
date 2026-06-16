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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// ==========================================================================
// 1. REVEAL SYSTEM TRIGGER ENGINE
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    // Find all elements containing the reveal class token
    const revealElements = document.querySelectorAll(".reveal");

    // Micro-timeout ensures the browser registers the initial 0 opacity state first
    setTimeout(() => {
        revealElements.forEach((el) => {
            el.classList.add("in");
        });
    }, 50);
});

// ==========================================================================
// 2. MODAL INTERACTIVE MANAGEMENT
// ==========================================================================
const lectureModal = document.getElementById("lectureModal");
const linkModal = document.getElementById("linkModal");

const btnOpenLecture = document.getElementById("btn-open-lecture-modal");
const btnOpenLink = document.getElementById("btn-open-link-modal");

// Setup Universal Close Buttons Logic
const closeButtons = document.querySelectorAll(".close-modal, .btn-cancel");

// Open Lecture Modal
if (btnOpenLecture) {
    btnOpenLecture.addEventListener("click", () => {
        lectureModal.style.display = "flex";
    });
}

// Open Link Modal
if (btnOpenLink) {
    btnOpenLink.addEventListener("click", () => {
        linkModal.style.display = "flex";
    });
}

// Close Modals Handling
closeButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
        // Prevents accidental form submissions inside action panels
        e.preventDefault();
        lectureModal.style.display = "none";
        linkModal.style.display = "none";
    });
});

// Close when clicking outside the card backdrop overlay area
window.addEventListener("click", (e) => {
    if (e.target === lectureModal) lectureModal.style.display = "none";
    if (e.target === linkModal) linkModal.style.display = "none";
});

// ==========================================================================
// 3. 🌟 FORMAT SLIDER TOGGLE IMPLEMENTATION
// ==========================================================================
const formatVideoRadio = document.getElementById("format-video");
const formatTextRadio = document.getElementById("format-text");

const dynamicContentLabel = document.getElementById("dynamic-content-label");
const inputLecUrl = document.getElementById("lec-url");
const inputTextarea = document.getElementById("lec-text");

function handleFormatToggle() {
    if (formatVideoRadio && formatVideoRadio.checked) {
        // Show URL track input area, hide text area canvas block
        dynamicContentLabel.textContent = "SLIDES / VIDEO URL";
        inputLecUrl.style.display = "block";
        inputLecUrl.required = true;

        inputTextarea.style.display = "none";
        inputTextarea.required = false;
        inputTextarea.value = ""; // Clear values safely
    } else if (formatTextRadio && formatTextRadio.checked) {
        // Hide URL track input, show essay block editor layout
        dynamicContentLabel.textContent = "WRITTEN LESSON CONTENT";
        inputLecUrl.style.display = "none";
        inputLecUrl.required = false;
        inputLecUrl.value = "";

        inputTextarea.style.display = "block";
        inputTextarea.required = true;
    }
}

// Attach event listeners to slider radio selectors
if (formatVideoRadio && formatTextRadio) {
    formatVideoRadio.addEventListener("change", handleFormatToggle);
    formatTextRadio.addEventListener("change", handleFormatToggle);
}

// ==========================================================================
// 4. FILTER BUTTON INTERACTIONS
// ==========================================================================
const filterButtons = document.querySelectorAll(".filter-btn");

filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
        // Remove active layout tracking from old focus
        document.querySelector(".filter-btn.active")?.classList.remove("active");
        // Append active styling status to target element
        btn.classList.add("active");

        const targetFilter = btn.getAttribute("data-filter");
        console.log(`Filtering data elements view by: ${targetFilter}`);
        // Filtering logic connected to Firebase rendering goes here next...
    });
});

const formAddLecture = document.getElementById("form-add-lecture");
const formAddLink = document.getElementById("form-add-link");
const resourceListContainer = document.getElementById("resource-list");
const resultCountBadge = document.getElementById("result-count");

let globalResources = []; // Stores the raw data so we can filter it instantly

if (formAddLecture) {
    formAddLecture.addEventListener("submit", async (e) => {
        e.preventDefault();

        const isVideo = document.getElementById("format-video").checked;

        const newLecture = {
            type: "lecture",
            title: document.getElementById("lec-title").value,
            tag: document.getElementById("lec-tag").value,
            meta: document.getElementById("lec-meta").value, // e.g., "S. Liu · 24 min"
            format: isVideo ? "video" : "text",
            content: isVideo ? document.getElementById("lec-url").value : document.getElementById("lec-text").value,
            timestamp: Date.now()
        };

        try {
            // Assuming 'db' is your initialized Realtime Database
            // push(ref(db, 'resources'), newLecture);
            console.log("Lecture saved!", newLecture);

            // Close modal and reset form
            lectureModal.style.display = "none";
            formAddLecture.reset();
            handleFormatToggle(); // Resets the dynamic input field
        } catch (error) {
            console.error("Error saving lecture:", error);
        }
    });
}

// 2. Submit Link
if (formAddLink) {
    formAddLink.addEventListener("submit", async (e) => {
        e.preventDefault();

        const newLink = {
            type: "link",
            title: document.getElementById("link-title").value,
            tag: document.getElementById("link-tag").value,
            meta: document.getElementById("link-type").value, // e.g., "Reference"
            url: document.getElementById("link-url").value,
            timestamp: Date.now()
        };

        try {
            // push(ref(db, 'resources'), newLink);
            console.log("Link saved!", newLink);

            linkModal.style.display = "none";
            formAddLink.reset();
        } catch (error) {
            console.error("Error saving link:", error);
        }
    });
}

// --- RENDERING STRATEGY ---

// Function to generate the HTML for a single row
function createResourceHTML(item, index) {
    // Determine icon based on type/format
    let iconSvg = '';
    if (item.type === "link") {
        iconSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`;
    } else if (item.format === "video") {
        iconSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
    } else {
        iconSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
    }

    // Calculate standard sequence delays for the reveal animation (.reveal-d1, d2, d3)
    const delayClass = `reveal-d${(index % 3) + 1}`;
    const indexDisplay = String(index + 1).padStart(2, '0');

    return `
    <div class="resource-row reveal ${delayClass}">
      <div class="res-index">${indexDisplay}</div>
      <div class="res-icon">${iconSvg}</div>
      <a href="${item.content || item.url}" target="_blank" class="res-title">${item.title}</a>
      <div class="res-tag">${item.tag}</div>
      <div class="res-meta">${item.meta}</div>
      <div class="res-action"></div> </div>
  `;
}

// Function to inject data into the DOM
function renderList(dataArray) {
    resourceListContainer.innerHTML = ""; // Clear current list

    if (dataArray.length === 0) {
        resourceListContainer.innerHTML = `<p style="color: #666; font-family: monospace; padding: 40px 0;">No resources found.</p>`;
        resultCountBadge.textContent = "0 RESULTS";
        return;
    }

    const htmlString = dataArray.map((item, index) => createResourceHTML(item, index)).join("");
    resourceListContainer.innerHTML = htmlString;
    resultCountBadge.textContent = `${dataArray.length} RESULT${dataArray.length !== 1 ? 'S' : ''}`;

    // Trigger the reveal animation for newly injected rows
    setTimeout(() => {
        const newReveals = resourceListContainer.querySelectorAll(".reveal");
        newReveals.forEach(el => el.classList.add("in"));
    }, 50);
}

// --- FILTERING LOGIC ---

// Updates the view when a filter button is clicked
function applyFilter(filterType) {
    if (filterType === "all") {
        renderList(globalResources);
    } else {
        const filtered = globalResources.filter(item => item.type === filterType);
        renderList(filtered);
    }
}

// Override the filter button listener from the previous step
filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
        document.querySelector(".filter-btn.active")?.classList.remove("active");
        btn.classList.add("active");

        const targetFilter = btn.getAttribute("data-filter");
        applyFilter(targetFilter);
    });
});

// --- MOCK DATA LOAD (Replace with your Firebase 'onValue' listener) ---
// This simulates fetching data from Firebase so you can test the layout immediately.
setTimeout(() => {
    globalResources = [
        { type: "lecture", title: "Introduction to React Hooks", tag: "Frontend", meta: "S. Liu · 24 min", format: "video", url: "#" },
        { type: "link", title: "Web3Schools: CSS Grid Guide", tag: "Design", meta: "Reference", url: "#" },
        { type: "lecture", title: "Data Structures: Linked Lists", tag: "Backend", meta: "M. Chen · Text", format: "text", url: "#" }
    ];
    renderList(globalResources);
}, 500); // 500ms delay to simulate network request