// Reusable GSAP animation helpers. IntersectionObserver decides *when* an
// animation runs; GSAP handles *how*. Every helper respects the user's
// prefers-reduced-motion setting by jumping straight to the final state.
import { gsap } from "gsap";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(SplitText);
gsap.defaults({ ease: "power3.out", duration: 0.6 });

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

export const prefersReducedMotion = () => motionQuery.matches;

// Shows an element without motion (used for reduced-motion users).
function showInstantly(targets) {
    return gsap.set(targets, { autoAlpha: 1, clearProps: "transform" });
}

// ─── CORE ANIMATIONS ──────────────────────────────────────────────
export function fadeInUp(element, delay = 0, options = {}) {
    if (prefersReducedMotion()) return showInstantly(element);
    return gsap.fromTo(element,
        { autoAlpha: 0, y: 24 },
        { autoAlpha: 1, y: 0, duration: 0.3, delay, ...options });
}

export function slideInLeft(element, delay = 0, options = {}) {
    if (prefersReducedMotion()) return showInstantly(element);
    return gsap.fromTo(element,
        { autoAlpha: 0, x: -60 },
        { autoAlpha: 1, x: 0, delay, ...options });
}

export function slideInRight(element, delay = 0, options = {}) {
    if (prefersReducedMotion()) return showInstantly(element);
    return gsap.fromTo(element,
        { autoAlpha: 0, x: 60 },
        { autoAlpha: 1, x: 0, delay, ...options });
}

// Scales from 0 by default; pass { from: 0.9 } for a subtler pop.
export function scaleUp(element, delay = 0, options = {}) {
    if (prefersReducedMotion()) return showInstantly(element);
    const { from = 0, ...rest } = options;
    return gsap.fromTo(element,
        { autoAlpha: 0, scale: from },
        { autoAlpha: 1, scale: 1, delay, ease: "back.out(1.4)", ...rest });
}

// Reveals text one rendered line at a time. SplitText re-splits on resize and
// font load, so lines stay correct at every breakpoint.
export function textReveal(element, delay = 0, options = {}) {
    if (prefersReducedMotion()) return showInstantly(element);
    gsap.set(element, { autoAlpha: 1 });
    let tween;
    SplitText.create(element, {
        type: "lines",
        mask: "lines",
        autoSplit: true,
        onSplit(self) {
            tween = gsap.from(self.lines, {
                yPercent: 110,
                duration: 0.7,
                stagger: 0.08,
                delay,
                ...options
            });
            return tween;
        }
    });
    return tween;
}

// The active theme's accent colour as rgba(), so glows follow the theme.
function accentColor(alpha) {
    const styles = getComputedStyle(document.documentElement);
    const hex = (styles.getPropertyValue("--ab-accent") || styles.getPropertyValue("--cs-accent") || "#FF6B4A").trim();
    const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!match) return hex;
    const [r, g, b] = match.slice(1).map(h => parseInt(h, 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Short attention pulse with a glow; runs a few times then stops.
export function pulseGlow(element, delay = 0, options = {}) {
    if (prefersReducedMotion()) return showInstantly(element);
    const { color = accentColor(0.75), repeat = 2 } = options;
    gsap.set(element, { autoAlpha: 1 });
    return gsap.timeline({ delay, repeat, repeatDelay: 0.6 })
        .to(element, { scale: 1.06, filter: `drop-shadow(0 0 18px ${color})`, duration: 0.35, ease: "sine.out" })
        .to(element, { scale: 1, filter: "drop-shadow(0 0 0px rgba(0,0,0,0))", duration: 0.5, ease: "sine.in" })
        .set(element, { clearProps: "filter,scale" });
}

// Fades a set of elements in one after another, e.g. nav links on load.
// Options: direction ("up" | "down"), distance, stagger, duration, delay.
export function staggerIn(targets, options = {}) {
    if (prefersReducedMotion()) return showInstantly(targets);
    const { direction = "up", distance = 12, stagger = 0.05, duration = 0.4, delay = 0 } = options;
    return gsap.fromTo(targets,
        { autoAlpha: 0, y: direction === "up" ? distance : -distance },
        { autoAlpha: 1, y: 0, duration, stagger, delay, clearProps: "transform" });
}

// Subtle GSAP lift on hover/focus. Returns a cleanup function.
export function hoverLift(elements, options = {}) {
    if (prefersReducedMotion()) return () => {};
    const { y = -2, scale = 1.03, duration = 0.3 } = options;
    const list = [].concat(elements instanceof NodeList ? [...elements] : elements);
    const handlers = list.map(el => {
        const enter = () => gsap.to(el, { y, scale, duration, overwrite: "auto" });
        const leave = () => gsap.to(el, { y: 0, scale: 1, duration, overwrite: "auto" });
        ["mouseenter", "focus"].forEach(evt => el.addEventListener(evt, enter));
        ["mouseleave", "blur"].forEach(evt => el.addEventListener(evt, leave));
        return { el, enter, leave };
    });
    return () => handlers.forEach(({ el, enter, leave }) => {
        ["mouseenter", "focus"].forEach(evt => el.removeEventListener(evt, enter));
        ["mouseleave", "blur"].forEach(evt => el.removeEventListener(evt, leave));
    });
}

// Drops a panel (menus, dropdowns) into view. Pass `items` to stagger its contents.
export function openPanel(panel, options = {}) {
    const { items = [], duration = 0.15, overlay = null } = options;
    gsap.killTweensOf([panel, overlay, ...items].filter(Boolean));
    if (prefersReducedMotion()) {
        gsap.set([panel, overlay, ...items].filter(Boolean), { autoAlpha: 1, clearProps: "transform,clipPath" });
        return null;
    }
    const tl = gsap.timeline();
    if (overlay) tl.fromTo(overlay, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: "power1.out" }, 0);
    tl.fromTo(panel,
        { autoAlpha: 1, clipPath: "inset(0 0 100% 0)", y: -8 },
        { clipPath: "inset(0 0 0% 0)", y: 0, duration, ease: "power2.out", clearProps: "clipPath,transform" }, 0);
    if (items.length) tl.fromTo(items, { autoAlpha: 0, y: -6 }, { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.04, ease: "power2.out" }, 0.05);
    return tl;
}

// Reverse of openPanel. Resolves once hidden so callers can toggle display.
export function closePanel(panel, options = {}) {
    const { duration = 0.15, overlay = null } = options;
    gsap.killTweensOf([panel, overlay].filter(Boolean));
    if (prefersReducedMotion()) return Promise.resolve();
    return new Promise(resolve => {
        const tl = gsap.timeline({ onComplete: resolve });
        tl.to(panel, { clipPath: "inset(0 0 100% 0)", duration, ease: "power2.in" }, 0);
        if (overlay) tl.to(overlay, { autoAlpha: 0, duration, ease: "power1.in" }, 0);
    });
}

export const animations = { fadeInUp, slideInLeft, slideInRight, scaleUp, textReveal, pulseGlow };

// ─── SCROLL TRIGGERS ──────────────────────────────────────────────
// Runs `animation` on each element matching `selector` the first time it
// scrolls into view. `animation` is a function above or its name as a string.
// Options: delay, threshold, rootMargin, once (default true), animationOptions.
export function createScrollTrigger(selector, animation, options = {}) {
    const {
        delay = 0,
        threshold = 0.15,
        rootMargin = "0px 0px -10% 0px",
        once = true,
        animationOptions = {}
    } = options;

    const run = typeof animation === "string" ? animations[animation] : animation;
    if (typeof run !== "function") throw new Error(`Unknown animation: ${animation}`);

    const elements = typeof selector === "string"
        ? [...document.querySelectorAll(selector)]
        : [].concat(selector);

    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
        elements.forEach(el => showInstantly(el));
        return null;
    }

    // Hide up front so nothing flashes before it animates in.
    gsap.set(elements, { autoAlpha: 0 });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            run(entry.target, delay, animationOptions);
            if (once) observer.unobserve(entry.target);
        });
    }, { threshold, rootMargin });

    elements.forEach(el => observer.observe(el));
    return observer;
}

// Animates every direct child of each matching parent in sequence once the
// parent scrolls into view. Options: animation, stagger, threshold, animationOptions.
export function batchAnimateChildren(parentSelector, options = {}) {
    const {
        animation = fadeInUp,
        stagger = 0.08,
        threshold = 0.15,
        animationOptions = {}
    } = options;

    const run = typeof animation === "string" ? animations[animation] : animation;
    const parents = typeof parentSelector === "string"
        ? [...document.querySelectorAll(parentSelector)]
        : [].concat(parentSelector);

    return parents.map(parent => {
        const children = [...parent.children];
        return createScrollTrigger(parent, () => {
            gsap.set(parent, { autoAlpha: 1 });
            children.forEach((child, i) => run(child, i * stagger, animationOptions));
        }, { threshold, animationOptions });
    });
}

// Terminal command + typing reveal (implemented in terminal-animations.js)
export { terminalCommandReveal, typingAnimation, skipAllTerminals } from "./terminal-animations.js";
