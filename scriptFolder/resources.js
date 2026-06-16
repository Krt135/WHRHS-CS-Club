import { initializeApp } from "firebase/app";
import {
    getAuth,
    onAuthStateChanged,
} from "firebase/auth";
import { 
    getDatabase, 
    ref, 
    push, 
    onValue,
    remove,
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
// ESSAY TEXT PARSERS
// ==========================================================================

function esc(s) {
    // Sanitizes text to prevent accidental HTML code injection
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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
const lessonModal = document.getElementById("lessonModal"); // Overlay viewer block target

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
        if (lessonModal) lessonModal.classList.remove("open");
    });
});

// Close when clicking outside the card backdrop overlay area
window.addEventListener("click", (e) => {
    if (e.target === lectureModal) lectureModal.style.display = "none";
    if (e.target === linkModal) linkModal.style.display = "none";
    if (e.target === lessonModal) lessonModal.classList.remove("open");
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
            meta: document.getElementById("lec-meta").value,
            format: isVideo ? "video" : "text",
            content: isVideo ? document.getElementById("lec-url").value : document.getElementById("lec-text").value,
            createdAt: serverTimestamp()
        };

        try {
            await push(ref(db, 'resources'), newLecture);
            console.log("Lecture saved!");
            
            lectureModal.style.display = "none";
            formAddLecture.reset();
            handleFormatToggle(); // Resets the input/textarea visibility perfectly
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
            meta: document.getElementById("link-type").value,
            url: document.getElementById("link-url").value,
            createdAt: serverTimestamp() // Smooth server synced time token
        };

        try {
            await push(ref(db, 'resources'), newLink);
            console.log("Link saved!");
            
            linkModal.style.display = "none";
            formAddLink.reset();
        } catch (error) {
            console.error("Error saving link:", error);
        }
    });
}

// ==========================================================================
// 5. RENDERING STRATEGY
// ==========================================================================

// Function to generate the HTML for a single row
function createResourceHTML(item, index) {
  let iconSvg = '';
  if (item.type === "link") {
    iconSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`;
  } else if (item.format === "video") {
    iconSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
  } else {
    iconSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
  }

  const delayClass = `reveal-d${(index % 3) + 1}`; 
  const indexDisplay = String(index + 1).padStart(2, '0');
  
  const isText = item.format === "text";
  let titleHtml = '';

  // 🌟 FIX: Checked & refactored to cleanly support full page overlay triggers
  if (isText) {
    titleHtml = `<button class="res-title btn-read-essay" title="Read Essay">${item.title}</button>`;
  } else {
    titleHtml = `<a href="${item.content || item.url}" target="_blank" class="res-title">${item.title}</a>`;
  }

  return `
    <div class="resource-row reveal ${delayClass}" data-id="${item.id}">
      <div class="res-index">${indexDisplay}</div>
      <div class="res-icon">${iconSvg}</div>
      ${titleHtml}
      <div class="res-tag">${item.tag}</div>
      <div class="res-meta">${item.meta}</div>
      <div class="res-action exec-only">
        <button class="btn-delete-resource" title="Delete Resource">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
      </div>
    </div>
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

// ==========================================================================
// 6. 🌟 FULL SCREEN OVERLAY ENGINE (FIXED LOGIC)
// ==========================================================================
function showLesson(firebaseKey) {
  // 1. Parse and build the data inside the window layout first
  renderLesson(firebaseKey); 
  
  // 2. Open the overlay view modal cleanly
  const modal = document.getElementById("lessonModal");
  if (modal) {
      modal.classList.add("open");
  }
}

function renderLesson(firebaseKey) {
  // FIX: Look inside the accurate data array tracked dynamically from Realtime Database
  const l = globalResources.find(item => item.id === firebaseKey); 
  if (!l) return;

  function parseContent(raw) {
    return (raw || "").split(/\n\n+/).map(para => {
      para = para.trim();
      // Handle === Headers ===
      if (para.startsWith("===")) {
        const h = para.replace(/^===\s*/, "").replace(/\s*===$/, "");
        return `<h3 class="essay-heading">${esc(h)}</h3>`;
      }
      // Handle [EXAMPLE] Boxes [/EXAMPLE]
      if (para.startsWith("[EXAMPLE]")) {
        const inner = para.replace("[EXAMPLE]", "").replace("[/EXAMPLE]", "").trim();
        return `<div class="essay-example-box"><strong>EXAMPLE</strong><br>${esc(inner)}</div>`;
      }
      // Standard paragraph
      return `<p class="essay-paragraph">${esc(para)}</p>`;
    }).join("");
  }

  const container = document.getElementById("lessonBody");
  if (!container) return;
  
  container.innerHTML = `
    <div class="lesson-content-wrapper">
        <h1 class="essay-title">${esc(l.title)}</h1>
        <div class="lesson-meta">Tag: ${esc(l.tag)} · Meta: ${esc(l.meta)}</div>
        <div class="lesson-divider"></div>
        <div class="lesson-text">
            ${parseContent(l.content)}
        </div>
    </div>
  `;
}

// ==========================================================================
// 7. EVENT DELEGATION LISTENER
// ==========================================================================
resourceListContainer.addEventListener("click", async (e) => {
    
    // 1. FIX: Hand off execution to full-screen overlay routing layer
    const readBtn = e.target.closest(".btn-read-essay");
    if (readBtn) {
        const row = readBtn.closest(".resource-row");
        const resourceId = row.getAttribute("data-id");
        
        if (resourceId) {
            showLesson(resourceId);
        }
        return; 
    }

    // 2. Check for Delete Button Click (Existing Logic)
    const deleteBtn = e.target.closest(".btn-delete-resource");
    if (!deleteBtn) return;

    const row = deleteBtn.closest(".resource-row");
    const resourceId = row.getAttribute("data-id");

    if (!resourceId) return;

    const confirmDelete = confirm("Are you sure you want to permanently remove this resource?");
    if (!confirmDelete) return;

    try {
        await remove(ref(db, `resources/${resourceId}`));
        console.log(`Resource ${resourceId} successfully deleted!`);
    } catch (error) {
        console.error("Error deleting resource from Firebase:", error);
        alert("Failed to delete resource. Check your permissions.");
    }
});

// ==========================================================================
// EXEC / ADMIN ROLE VISIBILITY CONTROLLER
// ==========================================================================
onAuthStateChanged(auth, (user) => {
    const execElements = document.querySelectorAll(".exec-only");

    if (user) {
        const userRoleRef = ref(db, `users/${user.uid}/role`);
        
        onValue(userRoleRef, (snapshot) => {
            const role = snapshot.val();
            
            if (role === "exec" || role === "admin") {
                execElements.forEach(el => el.style.display = "flex");
                document.documentElement.classList.add("is-exec-user");
            } else {
                execElements.forEach(el => el.style.display = "none");
                document.documentElement.classList.remove("is-exec-user");
            }
        });
    } else {
        execElements.forEach(el => el.style.display = "none");
        document.documentElement.classList.remove("is-exec-user");
    }
});

// --- FILTERING LOGIC ---
function applyFilter(filterType) {
    if (filterType === "all") {
        renderList(globalResources);
    } else {
        const filtered = globalResources.filter(item => item.type === filterType);
        renderList(filtered);
    }
}

// ==========================================================================
// LIVE SEARCH ENGINE FILTER
// ==========================================================================
const searchInput = document.getElementById("resource-search");

function performSearchAndFilter() {
    const activeFilterBtn = document.querySelector(".filter-btn.active");
    const currentCategory = activeFilterBtn ? activeFilterBtn.getAttribute("data-filter") : "all";
    const query = searchInput.value.toLowerCase().trim();

    const filteredResults = globalResources.filter(item => {
        const matchesCategory = (currentCategory === "all" || item.type === currentCategory);
        
        const itemTitle = (item.title || "").toLowerCase();
        const itemTag = (item.tag || "").toLowerCase();
        const itemMeta = (item.meta || "").toLowerCase();
        
        const matchesSearch = itemTitle.includes(query) || 
                              itemTag.includes(query) || 
                              itemMeta.includes(query);

        return matchesCategory && matchesSearch;
    });

    renderList(filteredResults);
}

if (searchInput) {
    searchInput.addEventListener("input", performSearchAndFilter);
}

filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
        document.querySelector(".filter-btn.active")?.classList.remove("active");
        btn.classList.add("active");
        performSearchAndFilter();
    });
});

// --- LIVE FIREBASE LISTENER ---
const resourcesRef = ref(db, 'resources');

onValue(resourcesRef, (snapshot) => {
    const data = snapshot.val();
    
    if (data) {
        globalResources = Object.keys(data).map(key => ({
            id: key, 
            ...data[key]
        }));
        
        renderList(globalResources);
    } else {
        resourceListContainer.innerHTML = `
            <div class="empty-state reveal in" style="text-align: center; padding: 60px 0; color: #444;">
                <p style="font-family: monospace;">// No resources currently available.</p>
                <p style="font-size: 12px; margin-top: 10px;">Check back later or add one above.</p>
            </div>
        `;
        resultCountBadge.textContent = "0 RESULTS";
    }
});