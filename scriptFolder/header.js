import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "whrhs-cs-club.firebaseapp.com",
  databaseURL: "https://whrhs-cs-club-default-rtdb.firebaseio.com",
  projectId: "whrhs-cs-club",
  storageBucket: "whrhs-cs-club.firebasestorage.app",
  messagingSenderId: "110216471172",
  appId: "1:110216471172:web:53ed19da91c397420258d1",
  measurementId: "G-ZYQZXSNML0",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);

function getProfileInitial(user) {
  const source =
    (user.displayName && user.displayName.trim()) ||
    (user.email && user.email.trim()) ||
    "?";
  return source.charAt(0).toUpperCase();
}

function updateAuthButtons(root, user) {
  const navAuth = root.querySelector("#nav-auth");
  const mobileAuth = root.querySelector("#mobile-auth-link");

  if (user) {
    const initial = getProfileInitial(user);

    if (navAuth) {
      navAuth.innerHTML = `<a href="account.html" class="btn-profile" aria-label="Your account">${initial}</a>`;
    }

    /* 🌟 FIX: Injecting the inner bubble wrapper safely via innerHTML */
    if (mobileAuth) {
      mobileAuth.href = "account.html";
      mobileAuth.innerHTML = `Account · <span class="btn-profile">${initial}</span>`;
    }
  } else {
    if (navAuth) {
      navAuth.innerHTML = `<a href="login.html" class="btn-signin">Sign in →</a>`;
    }

    if (mobileAuth) {
      mobileAuth.href = "login.html";
      mobileAuth.innerHTML = "Sign in →";
    }
  }
}

class SpecialHeader extends HTMLElement {
  connectedCallback() {
    const active = this.getAttribute("active-page") || "index";
    const isActive = (pageName) => (active === pageName ? "active" : "");

    this.innerHTML = `
            <div class="topbar">
                <span>WHRHS // Computer Science Club</span>
                <div class="topbar-center">
                    <span class="dot-live"></span>
                    <span>HillsHacks 2026 — March 21</span>
                </div>
                <span>v.2026.01 / Warren, NJ</span>
            </div>

            <header>
                <a href="index.html" class="nav-logo ${isActive("index")}">
                    <span class="nav-logo-icon">W/</span>
                    <span>WHRHS<span class="muted"> · CS Club</span></span>
                </a>
                <nav class="nav-links">
                    <a href="index.html#about" class="${isActive("about")}"><span class="num">01</span>About</a>
                    <a href="index.html#projects" class="${isActive("projects")}"><span class="num">02</span>Projects</a>
                    <a href="events.html" class="${isActive("events")}"><span class="num">03</span>Events</a>
                    <a href="resources.html" class="${isActive("resources")}"><span class="num">04</span>Resources</a>
                    <a href="index.html#sponsors" class="${isActive("sponsors")}"><span class="num">05</span>Sponsors</a>
                </nav>
                <div class="nav-right" id="nav-auth">
                    <a href="login.html" class="btn-signin">Sign in →</a>
                </div>
                <button class="menu-btn" id="menu-btn" aria-label="Toggle navigation">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 5h16M4 12h16M4 19h16"/></svg>
                </button>
            </header>

            <nav class="mobile-nav" id="mobile-nav" aria-label="Mobile navigation">
                <a href="index.html#about" class="${isActive("about")}">01 About</a>
                <a href="index.html#projects" class="${isActive("projects")}">02 Projects</a>
                <a href="events.html" class="${isActive("events")}">03 Events</a>
                <a href="resources.html" class="${isActive("resources")}">04 Resources</a>
                <a href="index.html#sponsors" class="${isActive("sponsors")}">05 Sponsors</a>
                <a href="login.html" id="mobile-auth-link">Sign in →</a>
            </nav>
        `;

    /* ==========================================================================
       🌟 ADDED: MOBILE MENU INTERACTIVE TOGGLE
       ========================================================================== */
    const menuBtn = this.querySelector("#menu-btn");
    const mobileNav = this.querySelector("#mobile-nav");

    if (menuBtn && mobileNav) {
      menuBtn.addEventListener("click", () => {
        mobileNav.classList.toggle("open");
        
        // Optional: Updates accessibility states dynamically
        const isExpanded = mobileNav.classList.contains("open");
        menuBtn.setAttribute("aria-expanded", isExpanded);
      });
    }

    onAuthStateChanged(auth, (user) => {
      updateAuthButtons(this, user);
    });
  }
}

customElements.define("cs-header", SpecialHeader);