// Finds every [data-terminal-command] element and plays its terminal reveal the
// first time it scrolls into view. Loaded on every page via header.js.
//
//   data-terminal-command="$ fetch_events()"   command to type (required)
//   data-content="Text to type"                 replaces the element's content (optional)
//   data-terminal-compact                       one-line terminal over a card, no typing
//   data-no-animation                           show immediately (also honours reduced motion)
import { armTerminal, terminalCommandReveal } from "./terminal-animations.js";

const played = new WeakSet();

function play(element) {
    if (played.has(element)) return;
    played.add(element);
    terminalCommandReveal(element.dataset.terminalCommand, element, element.dataset.content ?? null, {
        compact: element.hasAttribute("data-terminal-compact")
    });
}

const observer = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            observer.unobserve(entry.target);
            play(entry.target);
        });
    }, { threshold: 0.2, rootMargin: "0px 0px -10% 0px" })
    : null;

// Registers an element (including ones rendered later, e.g. project cards).
export function registerTerminal(element) {
    if (!element?.dataset.terminalCommand || played.has(element)) return;
    armTerminal(element, { compact: element.hasAttribute("data-terminal-compact") });
    if (observer) observer.observe(element);
    else play(element);
}

function init() {
    document.querySelectorAll("[data-terminal-command]").forEach(registerTerminal);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
