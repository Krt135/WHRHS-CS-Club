// Global animation initializer. Import once per page:
//     import "./global-animations.js";
//
// Declarative usage via data attributes:
//   data-animation="fadeInUp | slideInLeft | slideInRight | scaleUp | textReveal | pulseGlow | children | none"
//   data-delay="0.2"          seconds before the animation starts
//   data-trigger="load"       run on page load instead of on scroll (default: scroll)
//   data-from="0.85"          starting scale for scaleUp (default 0)
//   data-child-animation="scaleUp"  with data-animation="children": animation per child
//   data-stagger="0.1"        with data-animation="children": seconds between children
//
// Elements without data-animation get defaults by class:
//   .section-title → textReveal, .card → fadeInUp (staggered with sibling cards), .button → fadeInUp
//
// To avoid a flash of content before this module loads, pages can add to <head>:
//   <style>html.anim-pending [data-animation] { visibility: hidden; }</style>
//   <script>if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { document.documentElement.classList.add('anim-pending');
//     setTimeout(() => document.documentElement.classList.remove('anim-pending'), 3000); }</script>
import { animations, createScrollTrigger, batchAnimateChildren } from "./animations.js";

const CLASS_DEFAULTS = {
    ".section-title": "textReveal",
    ".card": "fadeInUp",
    ".button": "fadeInUp"
};

function optionsFor(el) {
    const opts = {};
    if (el.dataset.from !== undefined) opts.from = parseFloat(el.dataset.from);
    return opts;
}

function initElement(el, name, extraDelay = 0) {
    const delay = parseFloat(el.dataset.delay || 0) + extraDelay;

    if (name === "children") {
        batchAnimateChildren(el, {
            animation: el.dataset.childAnimation || "fadeInUp",
            stagger: parseFloat(el.dataset.stagger || 0.08),
            animationOptions: optionsFor(el)
        });
        return;
    }

    const run = animations[name];
    if (!run) {
        console.warn(`[animations] Unknown data-animation "${name}"`, el);
        return;
    }

    if (el.dataset.trigger === "load") {
        run(el, delay, optionsFor(el));
    } else {
        createScrollTrigger(el, run, { delay, animationOptions: optionsFor(el) });
    }
}

function init() {
    const handled = new Set();

    document.querySelectorAll("[data-animation]").forEach(el => {
        handled.add(el);
        const name = el.dataset.animation;
        if (name !== "none") initElement(el, name);
    });

    for (const [selector, name] of Object.entries(CLASS_DEFAULTS)) {
        document.querySelectorAll(selector).forEach(el => {
            if (handled.has(el) || el.closest("[data-animation='children']")) return;
            handled.add(el);
            // Stagger sibling cards so a grid ripples in instead of popping at once.
            const siblings = el.parentElement ? [...el.parentElement.querySelectorAll(`:scope > ${selector}`)] : [el];
            initElement(el, name, Math.max(0, siblings.indexOf(el)) * 0.08);
        });
    }

    document.documentElement.classList.remove("anim-pending");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
    init();
}
