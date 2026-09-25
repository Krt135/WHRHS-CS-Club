import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { staggerIn, hoverLift, openPanel, closePanel } from "./animations.js";
import "../styleFolder/site-header.css";
import "../styleFolder/themes.css";
import "./init-terminal-animations.js";

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
    const current = (pageName) => (active === pageName ? 'aria-current="page"' : "");

    this.innerHTML = `
            <div class="topbar">
                <span>WHRHS // Computer Science Club</span>
                <div class="topbar-center">
                    <span class="dot-live" aria-hidden="true"></span>
                    <span>HillsHacks 2026 — March 21</span>
                </div>
                <span>v.2026.01 / Warren, NJ</span>
            </div>

            <header class="site-header">
                <a href="index.html" class="nav-logo ${isActive("index")}">
                    <span class="nav-logo-icon" aria-hidden="true">W/</span>
                    <span>WHRHS<span class="muted"> · CS Club</span></span>
                </a>
                <nav class="nav-links" aria-label="Main navigation">
                    <a href="about.html" class="${isActive("about")}" ${current("about")}><span class="num">01</span>About</a>
                    <a href="projects.html" class="${isActive("projects")}" ${current("projects")}><span class="num">02</span>Projects</a>
                    <a href="events.html" class="${isActive("events")}" ${current("events")}><span class="num">03</span>Events</a>
                    <a href="resources.html" class="${isActive("resources")}" ${current("resources")}><span class="num">04</span>Resources</a>
                    <a href="sponsors.html" class="${isActive("sponsors")}" ${current("sponsors")}><span class="num">05</span>Sponsors</a>
                </nav>
                <div class="nav-right" id="nav-auth">
                    <a href="login.html" class="btn-signin">Sign in →</a>
                </div>
                <button class="menu-btn" id="menu-btn" aria-label="Toggle navigation" aria-expanded="false" aria-controls="mobile-nav">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16"/></svg>
                </button>

                <nav class="mobile-nav" id="mobile-nav" aria-label="Mobile navigation">
                    <a href="about.html" class="${isActive("about")}" ${current("about")}>01 About</a>
                    <a href="projects.html" class="${isActive("projects")}" ${current("projects")}>02 Projects</a>
                    <a href="events.html" class="${isActive("events")}" ${current("events")}>03 Events</a>
                    <a href="resources.html" class="${isActive("resources")}" ${current("resources")}>04 Resources</a>
                    <a href="sponsors.html" class="${isActive("sponsors")}" ${current("sponsors")}>05 Sponsors</a>
                    <a href="login.html" id="mobile-auth-link">Sign in →</a>
                </nav>
            </header>
            <div class="mobile-overlay" id="mobile-overlay" aria-hidden="true"></div>
        `;

    this.setupMobileMenu();
    this.animateIn();

    onAuthStateChanged(auth, (user) => {
      updateAuthButtons(this, user);
    });
  }

  setupMobileMenu() {
    const menuBtn = this.querySelector("#menu-btn");
    const mobileNav = this.querySelector("#mobile-nav");
    const overlay = this.querySelector("#mobile-overlay");
    if (!menuBtn || !mobileNav) return;

    let isOpen = false;

    const open = () => {
      isOpen = true;
      mobileNav.classList.add("open");
      overlay.classList.add("open");
      menuBtn.setAttribute("aria-expanded", "true");
      openPanel(mobileNav, { items: [...mobileNav.children], overlay });
    };

    const close = async ({ restoreFocus = false } = {}) => {
      if (!isOpen) return;
      isOpen = false;
      menuBtn.setAttribute("aria-expanded", "false");
      await closePanel(mobileNav, { overlay });
      if (isOpen) return; // reopened while closing
      mobileNav.classList.remove("open");
      overlay.classList.remove("open");
      if (restoreFocus) menuBtn.focus();
    };

    menuBtn.addEventListener("click", () => (isOpen ? close() : open()));
    overlay.addEventListener("click", () => close());
    mobileNav.addEventListener("click", (e) => { if (e.target.closest("a")) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close({ restoreFocus: true }); });
    window.matchMedia("(min-width: 900px)").addEventListener("change", (e) => { if (e.matches) close(); });
  }

  animateIn() {
    const topbarItems = this.querySelectorAll(".topbar > *");
    const headerItems = [
      this.querySelector(".nav-logo"),
      ...this.querySelectorAll(".nav-links a"),
      this.querySelector(".nav-right"),
      this.querySelector(".menu-btn")
    ].filter(Boolean);

    staggerIn(topbarItems, { direction: "down", distance: 8, stagger: 0.06, duration: 0.4 });
    staggerIn(headerItems, { direction: "down", distance: 10, stagger: 0.04, duration: 0.4, delay: 0.1 });
    hoverLift(this.querySelectorAll(".nav-links a"), { y: -2, scale: 1.04 });
  }
}

customElements.define("cs-header", SpecialHeader);
