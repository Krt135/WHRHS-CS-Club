// Home + About "Club by the numbers" strip. One read of stats/public (kept
// current by Cloud Functions; see functions/stats.js), then a count-up once
// the strip scrolls into view. Markup:
//   <div data-public-stat="membersCount" data-suffix="+">—</div>
import { db } from "./firebase.js";
import { ref, get } from "firebase/database";
import { countUp } from "./count-up.js";

const CACHE_KEY = "cs-public-stats";
const statEls = [...document.querySelectorAll("[data-public-stat]")];

const isCount = (value) => Number.isFinite(value) && value >= 0;

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeCache(stats) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(stats));
  } catch {
    // Storage blocked (private mode etc.); the cache is only a fallback.
  }
}

// Fresh values where valid, otherwise the last values this browser saw.
async function loadStats() {
  const cached = readCache();
  try {
    const fresh = (await get(ref(db, "stats/public"))).val() || {};
    const merged = { ...cached };
    for (const [key, value] of Object.entries(fresh)) {
      if (isCount(value)) merged[key] = value;
    }
    writeCache(merged);
    return merged;
  } catch (error) {
    console.error("Club stats unavailable, using last known values:", error);
    return cached;
  }
}

function whenVisible(el) {
  return new Promise((resolve) => {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      resolve();
    }, { threshold: 0.25 });
    observer.observe(el);
  });
}

if (statEls.length) {
  const strip = statEls[0].closest("section") || statEls[0];
  Promise.all([loadStats(), whenVisible(strip)]).then(([stats]) => {
    statEls.forEach((el, i) => {
      const value = stats[el.dataset.publicStat];
      // Unknown values keep the "—" placeholder rather than showing 0/NaN.
      if (!isCount(value)) return;
      countUp(el, value, { suffix: el.dataset.suffix || "", delay: 0.3 + i * 0.15 });
    });
  });
}
