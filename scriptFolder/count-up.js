// GSAP count-up for stat numbers (Projects dashboard, home/about stats strip).
import { gsap } from "gsap";

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// "—" for anything that isn't a real number, so we never print NaN/undefined.
export function formatCount(value, suffix = "") {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString()}${suffix}` : "—";
}

export function setCount(el, value, suffix = "") {
  el.textContent = formatCount(value, suffix);
}

// Counts el up from 0 to value. Skips straight to the value when animate is
// false, the user prefers reduced motion, or value isn't a number.
export function countUp(el, value, { delay = 0, duration = 1.1, suffix = "", animate = true } = {}) {
  if (!animate || reduceMotion() || !Number.isFinite(value)) {
    setCount(el, value, suffix);
    return;
  }
  const counter = { n: 0 };
  gsap.to(counter, {
    n: value,
    duration,
    delay,
    ease: "power2.out",
    onUpdate: () => setCount(el, counter.n, suffix),
    onComplete: () => setCount(el, value, suffix),
  });
}
