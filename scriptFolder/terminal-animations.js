// Terminal command + typing reveal. A small terminal types a command, "executes"
// it with a loading bar, reports success, then the real content types itself
// out in place. Content stays in the DOM the whole time (SplitText keeps an
// aria-label on the element), so layout doesn't jump and screen readers get the
// full text. Escape or the EXIT button finishes any running animation.
import { gsap } from "gsap";
import { SplitText } from "gsap/SplitText";
import "../styleFolder/terminal.css";

gsap.registerPlugin(SplitText);

const DEFAULTS = {
    commandDuration: 400,    // ms to type the command
    loadingDuration: 800,    // ms for the loading bar
    typingSpeed: 50,         // ms per content character…
    maxTypingDuration: 2000, // …but content never takes longer than this
    commandColor: null,      // overrides the theme accent for prompt/bar/success
    compact: false,          // one-line terminal over a card, no content typing
    messages: ["Compiling styles...", "Processing data...", "Rendering content..."]
};

const running = new Set();

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const skipsAnimation = (el) => prefersReducedMotion() || el.closest("[data-no-animation]") !== null;

// Finish every running terminal animation instantly.
export function skipAllTerminals() {
    [...running].forEach(tl => tl.progress(1));
}

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && running.size) skipAllTerminals();
});

// Hide a target until its reveal runs (called before it scrolls into view).
export function armTerminal(element, { compact = false } = {}) {
    if (skipsAnimation(element)) return;
    element.classList.add("term-host", compact ? "term-hide-children" : "term-armed");
}

function disarm(element) {
    element.classList.remove("term-armed", "term-hide-children");
}

function setContent(element, text) {
    if (text == null) return;
    element.textContent = "";
    String(text).split("\n").forEach((line, i) => {
        if (i) element.appendChild(document.createElement("br"));
        element.appendChild(document.createTextNode(line));
    });
}

function buildBox(command, { compact, commandColor }) {
    const box = document.createElement("div");
    box.className = "term-box" + (compact ? " is-compact" : "");
    box.setAttribute("aria-hidden", "true");
    if (commandColor) box.style.setProperty("--term-accent", commandColor);
    box.innerHTML = `
        <div class="term-line"><span class="term-prompt">$</span><span><span class="term-cmd"></span><span class="term-caret">|</span></span></div>
        <div class="term-status"></div>
        ${compact ? "" : '<div class="term-log"></div>'}
        <div class="term-bar"><span></span></div>
        ${compact ? "" : '<div class="term-pct">0%</div>'}
        ${compact ? "" : '<button type="button" class="term-exit" tabindex="-1">EXIT</button>'}`;
    return {
        box,
        cmd: box.querySelector(".term-cmd"),
        caret: box.querySelector(".term-caret"),
        status: box.querySelector(".term-status"),
        log: box.querySelector(".term-log"),
        fill: box.querySelector(".term-bar > span"),
        pct: box.querySelector(".term-pct"),
        exit: box.querySelector(".term-exit")
    };
}

// Splits `element` into hidden characters with a cursor, ready to type.
function prepareTyping(element) {
    const split = SplitText.create(element, { type: "words,chars", aria: "auto" });
    const cursor = document.createElement("span");
    cursor.className = "term-type-cursor";
    cursor.setAttribute("aria-hidden", "true");
    cursor.textContent = "|";
    const blink = gsap.to(cursor, { opacity: 0, duration: 0.45, repeat: -1, yoyo: true, ease: "steps(1)", paused: true });
    gsap.set(split.chars, { opacity: 0 });
    return {
        chars: split.chars, cursor, blink,
        cleanup: () => { blink.kill(); cursor.remove(); split.revert(); }
    };
}

// Adds the character-by-character reveal to `tl` at `position` (seconds).
function scheduleTyping(tl, typing, speedMs, maxMs, position) {
    const { chars, cursor, blink } = typing;
    const perChar = Math.max(0.004, Math.min(speedMs, maxMs / Math.max(chars.length, 1)) / 1000);
    tl.call(() => { chars[0]?.before(cursor); blink.play(); }, null, position);
    chars.forEach((char, i) => {
        tl.set(char, { opacity: 1 }, position + i * perChar);
        tl.call(() => char.after(cursor), null, position + i * perChar);
    });
    tl.to(cursor, { opacity: 0, duration: 0.2, onStart: () => blink.kill() }, position + chars.length * perChar + 0.1);
}

// Types `text` into `element` (or its existing content when text is null)
// with a blinking cursor. Resolves when done.
export function typingAnimation(text, element, speed = 50, options = {}) {
    setContent(element, text);
    if (skipsAnimation(element)) return Promise.resolve();
    const { maxDuration = Infinity } = options;
    const typing = prepareTyping(element);
    return new Promise(resolve => {
        const tl = gsap.timeline({ onComplete: () => { typing.cleanup(); running.delete(tl); resolve(); } });
        scheduleTyping(tl, typing, speed, maxDuration, 0);
        running.add(tl);
    });
}

// Full five-phase reveal: type command → execute with loading bar → success →
// type the content in place → settle. Resolves when the content is readable.
export function terminalCommandReveal(commandText, element, contentText = null, options = {}) {
    const o = { ...DEFAULTS, ...options };
    const command = String(commandText || "").replace(/^\s*\$\s*/, "");
    if (!o.compact) setContent(element, contentText);

    if (skipsAnimation(element)) {
        disarm(element);
        return Promise.resolve();
    }

    element.classList.add("term-host");
    // Split the real content before the terminal box is added inside the element
    const typing = o.compact ? null : prepareTyping(element);
    const children = o.compact ? [...element.children] : [];
    const ui = buildBox(command, o);
    element.appendChild(ui.box);
    const s = (ms) => ms / 1000;
    const scale = o.compact ? 0.6 : 1;

    return new Promise(resolve => {
        const tl = gsap.timeline({
            defaults: { ease: "power2.out" },
            onComplete: () => {
                typing?.cleanup();
                ui.box.remove();
                gsap.set(element, { clearProps: "transform,opacity" });
                disarm(element);
                running.delete(tl);
                resolve();
            }
        });
        running.add(tl);
        ui.exit?.addEventListener("click", () => tl.progress(1));

        // Full mode: characters are hidden individually now, so the element can
        // be shown with the terminal box overlaid on its (invisible) text. The box
        // may briefly overhang what follows rather than pushing the layout around.
        if (!o.compact) disarm(element);

        // PHASE 1 — command
        tl.fromTo(ui.box, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.15 }, 0);
        const typed = { n: 0 };
        tl.to(typed, {
            n: command.length, duration: s(o.commandDuration) * scale, ease: "none",
            onUpdate: () => { ui.cmd.textContent = command.slice(0, Math.round(typed.n)); }
        }, 0.1);
        const caretBlink = gsap.to(ui.caret, { opacity: 0, duration: 0.4, repeat: -1, yoyo: true, ease: "steps(1)" });

        // PHASE 2 — execute
        const load = s(o.loadingDuration) * scale;
        tl.call(() => { ui.status.textContent = "⚡ Executing..."; caretBlink.kill(); gsap.set(ui.caret, { opacity: 0 }); }, null, ">+0.08");
        tl.addLabel("load");
        const progress = { p: 0 };
        tl.to(progress, {
            p: 100, duration: load, ease: "none",
            onUpdate: () => {
                ui.fill.style.width = `${progress.p}%`;
                if (ui.pct) ui.pct.textContent = `${Math.round(progress.p)}%`;
            }
        }, "load");
        if (ui.log) o.messages.forEach((msg, i) => {
            tl.call(() => { ui.log.textContent = msg; }, null, `load+=${(load / o.messages.length) * i}`);
            tl.fromTo(ui.log, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.12 }, `load+=${(load / o.messages.length) * i}`);
        });

        // PHASE 3 — success, then fade the terminal out
        tl.call(() => { ui.status.textContent = "✓ Success"; ui.status.classList.add("is-success"); if (ui.log) ui.log.textContent = ""; }, null, ">");
        tl.to(ui.box, { boxShadow: "0 0 32px color-mix(in srgb, var(--term-accent) 70%, transparent)", duration: 0.1, yoyo: true, repeat: 1 }, "<");
        tl.to(ui.box, { autoAlpha: 0, y: -6, duration: 0.15, ease: "power1.in" }, ">+0.05");

        // PHASE 4 — content
        tl.addLabel("content", ">");
        if (typing) scheduleTyping(tl, typing, o.typingSpeed, o.maxTypingDuration, tl.labels.content);
        if (o.compact) {
            tl.call(() => disarm(element), null, "content");
            tl.from(children, { autoAlpha: 0, y: 8, duration: 0.3, stagger: 0.03 }, "content");
        }

        // PHASE 5 — settle
        tl.fromTo(element, { y: 6 }, { y: 0, duration: 0.3 }, o.compact ? ">" : "content");
    });
}
