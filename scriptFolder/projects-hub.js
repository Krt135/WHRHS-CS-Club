// Projects page: club stats dashboard + "Start here" resource hub.
// Cards render synchronously so global-animations.js (loaded after this) can
// animate them; stats fill in once the getClubStats function responds.
import { gsap } from "gsap";
import { ICONS, ENGINES, LEARNING } from "./resource-links.js";

const STATS_URL = "https://us-central1-whrhs-cs-club.cloudfunctions.net/getClubStats";
const REFRESH_MS = 5 * 60 * 1000;

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isExternal = (url) => /^https?:\/\//.test(url);

function linkAttrs(url) {
  return isExternal(url) ? `href="${url}" target="_blank" rel="noopener noreferrer"` : `href="${url}"`;
}

function brandIcon(key, fallback = "") {
  if (key && ICONS[key]) {
    return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${ICONS[key]}"/></svg>`;
  }
  return fallback;
}

// Generic "book" mark for links without a brand icon.
const BOOK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>`;

// ─── Resource hub ────────────────────────────────────────────────

function renderEngines() {
  const grid = document.getElementById("engineGrid");
  if (!grid) return;

  grid.innerHTML = ENGINES.map((engine) => `
    <article class="pj-engine">
      <div class="pj-engine-head">
        <span class="pj-engine-logo">${brandIcon(engine.icon, `<span class="pj-engine-mono">${engine.monogram}</span>`)}</span>
        <div>
          <h4>${engine.name}</h4>
          <p class="pj-engine-license">${engine.license}</p>
        </div>
      </div>
      <p class="pj-engine-desc">${engine.description}</p>
      <p class="pj-engine-best"><span>Best for</span> ${engine.bestFor}</p>
      <div class="pj-engine-actions">
        <a class="ab-btn ab-btn-accent pj-btn-sm" ${linkAttrs(engine.download)}>Download</a>
        <a class="ab-btn pj-btn-sm pj-btn-line" ${linkAttrs(engine.learn)}>Learn →</a>
      </div>
    </article>`).join("");
}

function renderLearning() {
  const wrap = document.getElementById("learningGrid");
  if (!wrap) return;

  wrap.innerHTML = LEARNING.map((group) => {
    const items = group.items.filter((item) => item.url);
    if (!items.length) return "";
    return `
      <div class="pj-learn-col">
        <h4 class="pj-learn-title">${group.title}</h4>
        <ul class="pj-learn-list">
          ${items.map((item) => `
            <li>
              <a class="pj-learn-link" ${linkAttrs(item.url)}>
                <span class="pj-learn-icon">${brandIcon(item.icon, BOOK_ICON)}</span>
                <span class="pj-learn-text">
                  <strong>${item.name}</strong>
                  <span>${item.note}</span>
                </span>
                <span class="pj-learn-go">${group.action} →</span>
              </a>
            </li>`).join("")}
        </ul>
      </div>`;
  }).join("");
}

// ─── Stats dashboard ─────────────────────────────────────────────

const statsSection = document.getElementById("club-stats");
const statusEl = document.getElementById("statsStatus");
const statEls = [...document.querySelectorAll("[data-stat]")];
let latest = null;
let revealed = false;
let inView = false;

function setNumber(el, value) {
  el.textContent = Number.isFinite(value) ? Math.round(value).toLocaleString() : "—";
}

function applyStats(stats, { animate }) {
  statEls.forEach((el, i) => {
    const value = stats[el.dataset.stat];
    if (!animate || reduceMotion()) {
      setNumber(el, value);
      return;
    }
    // Count up one card after another, once the hero strip has faded in.
    const counter = { n: 0 };
    gsap.to(counter, {
      n: value,
      duration: 1.1,
      delay: 0.7 + i * 0.18,
      ease: "power2.out",
      onUpdate: () => setNumber(el, counter.n),
      onComplete: () => setNumber(el, value),
    });
  });

  const total = stats.soloGames + stats.groupGames;
  const bar = document.getElementById("splitBar");
  if (bar) bar.style.setProperty("--solo-share", total ? `${(stats.soloGames / total) * 100}%` : "50%");

  statsSection?.classList.remove("is-loading");
}

function showUpdated() {
  if (!statusEl || !latest) return;
  const time = new Date(latest.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  statusEl.textContent = `Live from Firebase · updated ${time} · refreshes every 5 min`;
}

async function loadStats() {
  if (latest && statusEl) statusEl.textContent = "Refreshing…";
  try {
    const res = await fetch(STATS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    latest = await res.json();

    if (revealed) {
      applyStats(latest, { animate: false });
    } else if (inView) {
      revealed = true;
      applyStats(latest, { animate: true });
    }
    showUpdated();
  } catch (err) {
    console.error("Club stats unavailable:", err);
    statsSection?.classList.remove("is-loading");
    if (statusEl) {
      statusEl.textContent = latest
        ? "Couldn't refresh stats. Showing the last numbers we got."
        : "Stats are unavailable right now. Check back soon.";
    }
  }
}

function initStats() {
  if (!statsSection) return;

  // Numbers count up the first time the dashboard scrolls into view.
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    observer.disconnect();
    inView = true;
    if (latest && !revealed) {
      revealed = true;
      applyStats(latest, { animate: true });
    }
  }, { threshold: 0.25 });
  observer.observe(statsSection);

  loadStats();
  setInterval(() => {
    if (document.visibilityState === "visible") loadStats();
  }, REFRESH_MS);
}

renderEngines();
renderLearning();
initStats();
