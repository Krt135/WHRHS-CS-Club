// Site-wide announcement bar (<cs-announcement>). Imported by header.js and by
// the auth pages, it mounts itself as the first element in <body> so it pushes
// the ticker/header down instead of overlapping them.
//
// Reads are public. Creating/deleting is limited to role "admin" by the
// database rules; the role check here only decides whether to show the UI.
// Emailing members goes through the sendAnnouncementEmail Cloud Function.
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "firebase/auth";
import { ref, get, push, set, remove, onValue, serverTimestamp } from "firebase/database";

const MESSAGE_MAX = 500;
const LINK_TEXT_MAX = 60;
const URL_MAX = 2048;
const PREVIEW_CHARS = 80;
const CYCLE_MS = 6000;
const SAFE_PROTOCOLS = ["https:", "http:", "mailto:"];

// Returns {url} (normalized, possibly "") or {error}.
function parseAnnouncementUrl(raw) {
  let value = (raw || "").trim();
  if (!value) return { url: "" };
  if (/^www\./i.test(value)) value = `https://${value}`;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { error: "Enter a full link starting with https://, http:// or mailto:." };
  }
  if (!SAFE_PROTOCOLS.includes(parsed.protocol)) {
    return { error: "Only https://, http:// and mailto: links are allowed." };
  }
  if (parsed.href.length > URL_MAX) return { error: "That link is too long." };
  return { url: parsed.href };
}

const isSafeUrl = (url) => typeof url === "string" && !parseAnnouncementUrl(url).error;

const TEMPLATE = `
<style>
  :host {
    --ann-coral: #FF6B4A;
    --ann-coral-deep: #E8502F;
    --ann-black: #1A1A1A;
    --ann-charcoal: #232323;
    --ann-surface: #2A3F3F;
    --ann-highlight: #FFD23F;
    --ann-mono: 'JetBrains Mono', ui-monospace, monospace;
    --ann-sans: 'Space Grotesk', system-ui, sans-serif;
    display: block;
    width: 100%;
    flex: none;
    align-self: stretch;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  [hidden] { display: none !important; }
  button, input, select, textarea { font: inherit; color: inherit; }

  /* ── Bar ── */
  .bar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 52px;
    padding: 10px 56px 14px 24px;
    font-family: var(--ann-sans);
    overflow: hidden;
    transition: background-color 0.3s ease, color 0.3s ease;
  }
  /* Angled accent along the bottom edge, echoing the top ticker */
  .bar::after {
    content: "";
    position: absolute;
    right: -12px; bottom: 0;
    width: 28%; height: 3px;
    transform: skewX(-45deg);
    transform-origin: right bottom;
  }
  .bar.type-info { background: var(--ann-black); color: #fff; }
  .bar.type-info::after { background: var(--ann-coral); }
  .bar.type-urgent { background: var(--ann-coral); color: var(--ann-black); }
  .bar.type-urgent::after { background: var(--ann-black); }

  .prompt {
    flex-shrink: 0;
    font-family: var(--ann-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }
  .type-info .prompt { color: var(--ann-coral); }
  .type-urgent .prompt { color: var(--ann-black); }

  /* Slides stack in one grid cell so the bar grows to the tallest one */
  .slides { flex: 1; display: grid; min-width: 0; cursor: pointer; }
  .slides.single { cursor: default; }
  .slide {
    grid-area: 1 / 1;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 12px;
    opacity: 0;
    visibility: hidden;
    transform: translateY(6px);
    transition: opacity 0.35s ease, transform 0.35s ease, visibility 0.35s;
  }
  .slide.active { opacity: 1; visibility: visible; transform: none; }

  .badge {
    flex-shrink: 0;
    padding: 3px 12px;
    font-family: var(--ann-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%);
  }
  .type-info .badge { background: var(--ann-surface); color: #fff; }
  .type-urgent .badge { background: var(--ann-black); color: var(--ann-coral); }

  .text { font-size: 15px; font-weight: 500; line-height: 1.4; overflow-wrap: anywhere; }

  .read-more, .link {
    flex-shrink: 0;
    background: none;
    border: 0;
    cursor: pointer;
    font-family: var(--ann-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    text-decoration: underline;
    text-underline-offset: 3px;
    color: inherit;
  }
  .type-info .link { color: var(--ann-coral); }
  .read-more:hover, .link:hover { text-decoration-thickness: 2px; }
  .read-more:focus-visible, .link:focus-visible, .delete:focus-visible,
  .admin-trigger:focus-visible, .btn:focus-visible, .popup-close:focus-visible {
    outline: 2px solid var(--ann-highlight);
    outline-offset: 3px;
  }

  .dots {
    position: absolute;
    left: 50%; bottom: 6px;
    transform: translateX(-50%);
    display: flex;
    gap: 5px;
  }
  .dot {
    width: 10px; height: 3px;
    background: currentColor;
    opacity: 0.3;
    transform: skewX(-30deg);
    transition: opacity 0.2s, width 0.2s;
  }
  .dot.active { opacity: 0.9; width: 18px; }

  .delete {
    position: absolute;
    right: 14px; top: 50%;
    transform: translateY(-50%);
    display: grid; place-items: center;
    width: 30px; height: 30px;
    background: none;
    border: 0;
    cursor: pointer;
    opacity: 0.55;
    transition: opacity 0.2s;
  }
  .delete:hover { opacity: 1; }

  /* ── Admin composer ── */
  .admin {
    background: var(--ann-surface);
    color: #fff;
    font-family: var(--ann-mono);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .admin-trigger {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 8px 24px;
    background: none;
    border: 0;
    cursor: pointer;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #b9c6c6;
  }
  .admin-trigger:hover { color: var(--ann-coral); }
  .admin-trigger .caret { color: var(--ann-coral); }

  .compose { display: grid; gap: 10px; padding: 14px 24px 16px; }
  .compose-head {
    font-size: 11px; font-weight: 700; letter-spacing: 0.2em;
    text-transform: uppercase; color: var(--ann-coral);
  }
  .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .field { position: relative; flex: 1 1 220px; min-width: 0; }
  .field.wide { flex-basis: 100%; }
  .input {
    width: 100%;
    padding: 9px 12px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 0;
    font-family: var(--ann-sans);
    font-size: 14px;
    color: #fff;
    outline: none;
  }
  textarea.input { resize: vertical; min-height: 64px; padding-bottom: 22px; line-height: 1.4; }
  .input::placeholder { color: rgba(255, 255, 255, 0.4); }
  .input:focus { border-color: var(--ann-coral); }
  .input[aria-invalid="true"] { border-color: var(--ann-highlight); }
  select.input { flex: 0 0 auto; width: auto; cursor: pointer; font-family: var(--ann-mono); }
  select.input option { background: var(--ann-black); }
  .counter {
    position: absolute; right: 8px; bottom: 6px;
    font-size: 10px; color: rgba(255, 255, 255, 0.45);
    pointer-events: none;
  }
  .check {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 12px; letter-spacing: 0.05em; cursor: pointer;
  }
  .check input { width: 16px; height: 16px; accent-color: var(--ann-coral); }

  .btn {
    padding: 9px 22px;
    border: 0;
    cursor: pointer;
    font-family: var(--ann-mono);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%);
    transition: background-color 0.2s, transform 0.2s;
  }
  .btn:hover { transform: translateX(3px); }
  .btn:disabled { opacity: 0.5; cursor: wait; transform: none; }
  .btn-post { background: var(--ann-coral); color: var(--ann-black); }
  .btn-post:hover { background: var(--ann-highlight); }
  .btn-cancel { background: transparent; color: #fff; box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.4); clip-path: none; }

  .error { font-size: 12px; color: var(--ann-highlight); }
  .status { font-size: 12px; color: #b9c6c6; }
  .status.ok { color: #7ee2a8; }
  .status.warn { color: var(--ann-highlight); }

  /* ── Read-more popup ── */
  .overlay {
    position: fixed; inset: 0; z-index: 9999;
    display: flex; align-items: center; justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.6);
  }
  .popup {
    position: relative;
    width: 100%; max-width: 520px;
    max-height: 80vh; overflow-y: auto;
    padding: 32px 32px 28px;
    background: var(--ann-black);
    color: #fff;
    border-top: 4px solid var(--ann-coral);
    font-family: var(--ann-sans);
    clip-path: polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%);
  }
  .popup.urgent { border-top-color: var(--ann-highlight); }
  .popup-label {
    margin-bottom: 14px;
    font-family: var(--ann-mono);
    font-size: 11px; font-weight: 700;
    letter-spacing: 0.2em; text-transform: uppercase;
    color: var(--ann-coral);
  }
  .popup-text { font-size: 16px; line-height: 1.6; white-space: pre-line; overflow-wrap: anywhere; }
  .popup .link { display: inline-block; margin-top: 18px; color: var(--ann-coral); }
  .popup-close {
    position: absolute; top: 10px; right: 12px;
    width: 32px; height: 32px;
    background: none; border: 0; cursor: pointer;
    font-family: var(--ann-mono); font-size: 16px; color: #b9c6c6;
  }
  .popup-close:hover { color: var(--ann-coral); }

  @media (max-width: 700px) {
    .bar { padding: 10px 44px 16px 16px; gap: 10px; }
    .prompt { display: none; }
    .text { font-size: 14px; }
    .delete { right: 6px; }
    .admin-trigger { padding: 8px 16px; }
    .compose { padding: 12px 16px 14px; }
    .popup { padding: 28px 20px 24px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .slide, .bar, .dot, .btn { transition: none; }
  }
</style>

<div class="admin" id="admin" hidden>
  <button class="admin-trigger" id="admin-trigger" type="button" aria-expanded="false" aria-controls="compose">
    <span class="caret">$</span> announce --new
  </button>
  <form class="compose" id="compose" novalidate hidden>
    <p class="compose-head">$ announce --post</p>
    <div class="row">
      <div class="field wide">
        <textarea class="input" id="msg" rows="2" maxlength="${MESSAGE_MAX}" placeholder="Announcement message…" aria-label="Announcement message"></textarea>
        <span class="counter" id="counter">0/${MESSAGE_MAX}</span>
      </div>
    </div>
    <div class="row">
      <div class="field">
        <input class="input" id="link-text" type="text" maxlength="${LINK_TEXT_MAX}" placeholder="Link text (optional)" aria-label="Link text">
      </div>
      <div class="field">
        <input class="input" id="url" type="text" inputmode="url" maxlength="${URL_MAX}" placeholder="https://… or mailto:… (optional)" aria-label="Link URL" aria-describedby="error">
      </div>
      <select class="input" id="type" aria-label="Announcement type">
        <option value="info">Info</option>
        <option value="urgent">Urgent</option>
      </select>
    </div>
    <div class="row">
      <label class="check"><input type="checkbox" id="email" checked> Also email all members</label>
    </div>
    <p class="error" id="error" role="alert" hidden></p>
    <div class="row">
      <button class="btn btn-post" id="post" type="submit">Post →</button>
      <button class="btn btn-cancel" id="cancel" type="button">Close</button>
      <span class="status" id="status" role="status"></span>
    </div>
  </form>
</div>

<div class="bar type-info" id="bar" role="region" aria-label="Announcements" hidden>
  <span class="prompt" aria-hidden="true">$ announce</span>
  <div class="slides" id="slides" aria-live="polite"></div>
  <div class="dots" id="dots" aria-hidden="true"></div>
  <button class="delete" id="delete" type="button" title="Delete this announcement" aria-label="Delete this announcement" hidden>
    <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
    </svg>
  </button>
</div>

<div class="overlay" id="overlay" hidden>
  <div class="popup" id="popup" role="dialog" aria-modal="true" aria-labelledby="popup-label">
    <button class="popup-close" id="popup-close" type="button" aria-label="Close">✕</button>
    <p class="popup-label" id="popup-label">$ announce</p>
    <p class="popup-text" id="popup-text"></p>
    <div id="popup-link"></div>
  </div>
</div>
`;

class CsAnnouncement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._announcements = [];
    this._index = 0;
    this._timer = null;
    this._isAdmin = false;
    this._unsubs = [];
  }

  connectedCallback() {
    if (this._unsubs.length) return;
    this.shadowRoot.innerHTML = TEMPLATE;
    this.$ = (id) => this.shadowRoot.getElementById(id);

    this._bindBar();
    this._bindPopup();
    this._bindComposer();

    this._unsubs.push(onValue(ref(db, "announcements"), (snap) => {
      const raw = snap.val() || {};
      this._announcements = Object.entries(raw)
        .map(([id, value]) => ({ id, ...value }))
        .filter((a) => typeof a.message === "string" && a.message.trim())
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      this._index = 0;
      this._render();
    }, (error) => console.error("Unable to load announcements:", error)));

    this._unsubs.push(onAuthStateChanged(auth, async (user) => {
      let isAdmin = false;
      if (user) {
        try {
          isAdmin = (await get(ref(db, `users/${user.uid}/role`))).val() === "admin";
        } catch (error) {
          console.error("Unable to check announcement permissions:", error);
        }
      }
      this._isAdmin = isAdmin;
      this.$("admin").hidden = !isAdmin;
      this.$("delete").hidden = !isAdmin;
    }));
  }

  disconnectedCallback() {
    this._stopCycle();
    this._unsubs.forEach((unsub) => unsub());
    this._unsubs = [];
  }

  // ---------- display ----------

  _render() {
    const bar = this.$("bar");
    const slides = this.$("slides");
    const dots = this.$("dots");
    this._stopCycle();
    slides.replaceChildren();
    dots.replaceChildren();

    const count = this._announcements.length;
    bar.hidden = count === 0;
    if (!count) return;

    this._announcements.forEach((ann, i) => {
      const slide = document.createElement("div");
      slide.className = "slide" + (i === 0 ? " active" : "");
      slide.setAttribute("aria-hidden", i === 0 ? "false" : "true");

      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = ann.type === "urgent" ? "! Urgent" : "Info";

      const text = document.createElement("span");
      text.className = "text";
      const truncated = ann.message.length > PREVIEW_CHARS;
      text.textContent = truncated
        ? `${ann.message.slice(0, PREVIEW_CHARS).trimEnd()}…`
        : ann.message;

      slide.append(badge, text);

      if (truncated) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "read-more";
        more.textContent = "Read more";
        more.addEventListener("click", () => this._openPopup(ann));
        slide.append(more);
      }

      const link = this._buildLink(ann);
      if (link) slide.append(link);

      slides.append(slide);

      const dot = document.createElement("span");
      dot.className = "dot" + (i === 0 ? " active" : "");
      dots.append(dot);
    });

    slides.classList.toggle("single", count === 1);
    dots.hidden = count < 2;
    this._applyType();
    this._startCycle();
  }

  _buildLink(ann) {
    if (!ann.url || !isSafeUrl(ann.url)) return null;
    const link = document.createElement("a");
    link.className = "link";
    link.href = ann.url;
    link.textContent = `${ann.linkText || "Learn more"} →`;
    if (!ann.url.toLowerCase().startsWith("mailto:")) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    return link;
  }

  _applyType() {
    const ann = this._announcements[this._index];
    const bar = this.$("bar");
    bar.classList.toggle("type-urgent", ann?.type === "urgent");
    bar.classList.toggle("type-info", ann?.type !== "urgent");
  }

  _show(index) {
    const slides = this.shadowRoot.querySelectorAll(".slide");
    const dots = this.shadowRoot.querySelectorAll(".dot");
    if (!slides.length) return;
    slides[this._index]?.classList.remove("active");
    slides[this._index]?.setAttribute("aria-hidden", "true");
    dots[this._index]?.classList.remove("active");
    this._index = (index + slides.length) % slides.length;
    slides[this._index].classList.add("active");
    slides[this._index].setAttribute("aria-hidden", "false");
    dots[this._index]?.classList.add("active");
    this._applyType();
  }

  _startCycle() {
    this._stopCycle();
    if (this._announcements.length > 1 && this.$("overlay").hidden) {
      this._timer = setInterval(() => this._show(this._index + 1), CYCLE_MS);
    }
  }

  _stopCycle() {
    clearInterval(this._timer);
    this._timer = null;
  }

  _bindBar() {
    const bar = this.$("bar");
    this.$("slides").addEventListener("click", (e) => {
      if (e.target.closest("button, a") || this._announcements.length < 2) return;
      this._show(this._index + 1);
      this._startCycle();
    });
    // Pause while someone is reading or tabbing through a slide.
    bar.addEventListener("mouseenter", () => this._stopCycle());
    bar.addEventListener("mouseleave", () => this._startCycle());
    bar.addEventListener("focusin", () => this._stopCycle());
    bar.addEventListener("focusout", () => this._startCycle());

    this.$("delete").addEventListener("click", async () => {
      const ann = this._announcements[this._index];
      if (!ann || !this._isAdmin) return;
      if (!confirm(`Delete this announcement?\n\n"${ann.message.slice(0, 120)}"`)) return;
      try {
        await remove(ref(db, `announcements/${ann.id}`));
      } catch (error) {
        console.error("Unable to delete announcement:", error);
        alert("Couldn't delete the announcement. Are you signed in as an admin?");
      }
    });
  }

  // ---------- read-more popup ----------

  _bindPopup() {
    const overlay = this.$("overlay");
    this.$("popup-close").addEventListener("click", () => this._closePopup());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) this._closePopup(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.hidden) this._closePopup();
    });
  }

  _openPopup(ann) {
    this._stopCycle();
    this._returnFocus = this.shadowRoot.activeElement;
    const urgent = ann.type === "urgent";
    this.$("popup").classList.toggle("urgent", urgent);
    this.$("popup-label").textContent = urgent ? "$ announce --urgent" : "$ announce";
    this.$("popup-text").textContent = ann.message;
    const link = this._buildLink(ann);
    this.$("popup-link").replaceChildren(...(link ? [link] : []));
    this.$("overlay").hidden = false;
    this.$("popup-close").focus();
  }

  _closePopup() {
    this.$("overlay").hidden = true;
    this._returnFocus?.focus?.();
    this._startCycle();
  }

  // ---------- admin composer ----------

  _bindComposer() {
    const trigger = this.$("admin-trigger");
    const form = this.$("compose");
    const msg = this.$("msg");
    const url = this.$("url");

    const setOpen = (open) => {
      form.hidden = !open;
      trigger.hidden = open;
      trigger.setAttribute("aria-expanded", String(open));
      if (open) msg.focus();
      else trigger.focus();
    };

    trigger.addEventListener("click", () => setOpen(true));
    this.$("cancel").addEventListener("click", () => {
      this._showError("");
      this._setStatus("");
      setOpen(false);
    });

    msg.addEventListener("input", () => {
      this.$("counter").textContent = `${msg.value.length}/${MESSAGE_MAX}`;
    });
    url.addEventListener("input", () => {
      url.removeAttribute("aria-invalid");
      this._showError("");
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this._post();
    });
  }

  _showError(text) {
    const error = this.$("error");
    error.textContent = text;
    error.hidden = !text;
  }

  _setStatus(text, tone = "") {
    const status = this.$("status");
    status.textContent = text;
    status.className = "status" + (tone ? ` ${tone}` : "");
  }

  async _post() {
    if (this._posting) return;
    const user = auth.currentUser;
    if (!user || !this._isAdmin) return;

    const msgEl = this.$("msg");
    const urlEl = this.$("url");
    const message = msgEl.value.trim();
    const linkText = this.$("link-text").value.trim();
    const type = this.$("type").value === "urgent" ? "urgent" : "info";
    const sendEmail = this.$("email").checked;

    this._showError("");
    this._setStatus("");
    if (!message) {
      this._showError("Write a message first.");
      msgEl.focus();
      return;
    }
    if (message.length > MESSAGE_MAX) {
      this._showError(`Keep the message under ${MESSAGE_MAX} characters.`);
      return;
    }
    if (linkText.length > LINK_TEXT_MAX) {
      this._showError(`Keep the link text under ${LINK_TEXT_MAX} characters.`);
      return;
    }
    const { url, error } = parseAnnouncementUrl(urlEl.value);
    if (error) {
      urlEl.setAttribute("aria-invalid", "true");
      this._showError(error);
      urlEl.focus();
      return;
    }
    if (linkText && !url) {
      this._showError("Add a URL for the link text, or clear the link text.");
      urlEl.focus();
      return;
    }

    const entry = {
      message,
      type,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
      emailSent: false,
    };
    if (url) {
      entry.url = url;
      if (linkText) entry.linkText = linkText;
    }

    const postBtn = this.$("post");
    this._posting = true;
    postBtn.disabled = true;
    this._setStatus("Posting…");

    try {
      const annRef = push(ref(db, "announcements"));
      try {
        await set(annRef, entry);
      } catch (err) {
        console.error("Unable to post announcement:", err);
        this._setStatus("");
        this._showError("Couldn't post. Make sure you're signed in as an admin.");
        return;
      }

      msgEl.value = "";
      this.$("link-text").value = "";
      urlEl.value = "";
      this.$("type").value = "info";
      this.$("counter").textContent = `0/${MESSAGE_MAX}`;

      if (!sendEmail) {
        this._setStatus("Posted. No email sent.", "ok");
        return;
      }

      this._setStatus("Posted. Emailing members…");
      try {
        const { getFunctions, httpsCallable } = await import("firebase/functions");
        const sendAnnouncementEmail = httpsCallable(getFunctions(auth.app), "sendAnnouncementEmail");
        const { data } = await sendAnnouncementEmail({ id: annRef.key });
        const noun = data.sent === 1 ? "member" : "members";
        if (data.testMode) {
          this._setStatus(`Posted. Test mode: emailed only you (${data.sent} sent).`, "warn");
        } else if (data.sent < data.recipients) {
          this._setStatus(`Posted. Emailed ${data.sent} of ${data.recipients} members; some failed (see function logs).`, "warn");
        } else {
          this._setStatus(`Posted. Emailed ${data.sent} ${noun}.`, "ok");
        }
      } catch (err) {
        console.error("Announcement email failed:", err);
        this._setStatus(`Posted, but email failed: ${err.message || "unknown error"}`, "warn");
      }
    } finally {
      this._posting = false;
      postBtn.disabled = false;
    }
  }
}

if (!customElements.get("cs-announcement")) {
  customElements.define("cs-announcement", CsAnnouncement);
}

// Mount once, as the very first thing on the page.
if (!document.querySelector("cs-announcement")) {
  document.body.prepend(document.createElement("cs-announcement"));
}
