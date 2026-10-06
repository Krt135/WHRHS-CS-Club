import { app } from './app.js';
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getDatabase, ref, get, push, remove, onValue } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-database.js";

const auth = getAuth(app);
const db = getDatabase(app);

const style = `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,600;0,700;1,400&display=swap');

:host {
  display: block;
  width: 100%;
}
    * { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Bar ───────────────────────────────────────────────────────── */
    .announcement-bar {
      position: relative;
      width: 100%;
      min-height: 70px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Crimson Pro', Georgia, serif;
      overflow: hidden;
      transition: min-height 0.3s ease;
    }

    .announcement-bar.empty { display: none; }

    .announcement-bar.type-info {
      background: #0f1f3d;
      color: #fff;
      border-bottom: 2px solid #1a2e52;
    }

    .announcement-bar.type-urgent {
      background: #c9a84c;
      color: #0f1f3d;
      border-bottom: 2px solid #b8943e;
    }

    /* ── Slides ────────────────────────────────────────────────────── */
    .slides-wrap {
      flex: 1;
      position: relative;
      overflow: hidden;
      height: 40px;
      cursor: pointer;
    }

    .slide {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 0 48px;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.4s ease, transform 0.4s ease;
      pointer-events: none;
      text-align: center;
    }

    .slide.active {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }

    .slide-badge {
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      padding: 2px 8px;
      border-radius: 3px;
      flex-shrink: 0;
    }

    .type-info .slide-badge {
      background: rgba(201,168,76,0.2);
      color: #c9a84c;
      border: 1px solid rgba(201,168,76,0.4);
    }

    .type-urgent .slide-badge {
      background: rgba(15,31,61,0.15);
      color: #0f1f3d;
      border: 1px solid rgba(15,31,61,0.25);
    }

    .slide-text {
      font-size: 1.5rem;
      font-weight: 400;
      line-height: 1.3;
    }

    .slide-link {
      font-size: 0.82rem;
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 2px;
      opacity: 0.8;
      cursor: pointer;
      flex-shrink: 0;
      transition: opacity 0.15s;
    }

    .slide-link:hover { opacity: 1; }

    .type-info .slide-link { color: #c9a84c; }
    .type-urgent .slide-link { color: #0f1f3d; }

    /* ── Read more button ──────────────────────────────────────────── */
    .read-more-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-family: 'Crimson Pro', Georgia, serif;
      font-size: 1.1rem;
      font-weight: 700;
      text-decoration: underline;
      text-underline-offset: 2px;
      padding: 0 0 0 4px;
      color: inherit;
      opacity: 0.75;
      transition: opacity 0.15s;
    }

    .read-more-btn:hover { opacity: 1; }

    /* ── Dots ──────────────────────────────────────────────────────── */
    .dots {
      position: absolute;
      bottom: 5px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 5px;
    }

    .dot {
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.3;
      transition: opacity 0.2s;
    }

    .dot.active { opacity: 0.9; }

    /* ── Delete button (admin only) ────────────────────────────────── */
    .delete-btn {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      cursor: pointer;
      opacity: 0.45;
      padding: 4px;
      display: flex;
      align-items: center;
      transition: opacity 0.2s;
      color: inherit;
    }

    .delete-btn:hover { opacity: 1; }

    /* ── Admin post bar ────────────────────────────────────────────── */
    .admin-bar {
      background: #0f1f3d;
      border-bottom: 1px solid #1a2e52;
      font-family: 'Crimson Pro', Georgia, serif;
      display: none;
      width: 100%;
    }

    .admin-bar.visible { display: block; }

    .admin-trigger {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 18px;
      cursor: pointer;
      color: rgba(255,255,255,0.55);
      font-size: 0.82rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      transition: color 0.2s;
      user-select: none;
      width: fit-content;
    }

    .admin-trigger:hover { color: #c9a84c; }
    .admin-trigger svg { flex-shrink: 0; }

    .admin-compose {
      display: none;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      flex-wrap: wrap;
    }

    .admin-compose.open { display: flex; }

    .compose-input {
      flex: 1;
      min-width: 200px;
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 5px;
      padding: 7px 12px;
      color: #fff;
      font-family: 'Crimson Pro', Georgia, serif;
      font-size: 0.92rem;
      outline: none;
      transition: border-color 0.2s;
    }

    .compose-input::placeholder { color: rgba(255,255,255,0.35); }
    .compose-input:focus { border-color: rgba(201,168,76,0.6); }
    .compose-input.short { flex: 0 0 180px; min-width: 0; }

    .compose-select {
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 5px;
      padding: 7px 10px;
      color: #fff;
      font-family: 'Crimson Pro', Georgia, serif;
      font-size: 0.88rem;
      outline: none;
      cursor: pointer;
      transition: border-color 0.2s;
    }

    .compose-select:focus { border-color: rgba(201,168,76,0.6); }
    .compose-select option { background: #0f1f3d; }

    .compose-btn {
      padding: 7px 18px;
      border-radius: 5px;
      font-family: 'Crimson Pro', Georgia, serif;
      font-size: 0.88rem;
      font-weight: 700;
      cursor: pointer;
      border: none;
      transition: opacity 0.15s, transform 0.1s;
      letter-spacing: 0.03em;
    }

    .compose-btn:hover { opacity: 0.88; transform: translateY(-1px); }
    .compose-btn:active { transform: translateY(0); }
    .compose-btn.post { background: #c9a84c; color: #0f1f3d; }
    .compose-btn.cancel { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6); }

    /* ── Read more popup ───────────────────────────────────────────── */
    .ann-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      z-index: 9999;
      align-items: center;
      justify-content: center;
    }

    .ann-overlay.open { display: flex; }

    .ann-popup {
      background: #fff;
      border-radius: 10px;
      padding: 32px 36px;
      max-width: 480px;
      width: 90%;
      position: relative;
      font-family: 'Crimson Pro', Georgia, serif;
      font-size: 1.05rem;
      color: #0f1f3d;
      line-height: 1.6;
      box-shadow: 0 20px 60px rgba(0,0,0,0.2);
    }

    .ann-popup-close {
      position: absolute;
      top: 12px;
      right: 14px;
      background: none;
      border: none;
      font-size: 1rem;
      cursor: pointer;
      color: #6b7280;
      transition: color 0.15s;
      line-height: 1;
    }

    .ann-popup-close:hover { color: #0f1f3d; }

    .ann-popup-label {
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #c9a84c;
      margin-bottom: 10px;
    }

    .ann-popup-text { margin: 0; }

    /* ── Mobile ── */
    @media (max-width: 700px) {
      .announcement-bar { min-height: 60px; }
      .slide { padding: 0 20px; gap: 6px; }
      .slide-text { font-size: 1rem; }
      .slide-badge { display: none; }
      .slide-link { font-size: 0.72rem; }
      .admin-trigger { padding: 8px 14px; }
      .admin-compose { flex-wrap: wrap; padding: 10px 14px; }
      .compose-input { min-width: 100%; }
      .compose-input.short { flex: 1 1 auto; min-width: 0; }
      .delete-btn { right: 6px; }
      .ann-popup { padding: 24px 22px; width: 88%; }
    }
  </style>
`;

class TEFAnnouncement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._announcements = [];
    this._currentIndex = 0;
    this._cycleTimer = null;
    this._isAdmin = false;
  }

  async connectedCallback() {
    try {
      this.shadowRoot.innerHTML = style + `
        <!-- Admin post bar -->
        <div class="admin-bar" id="admin-bar">
          <div class="admin-trigger" id="admin-trigger">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Post Announcement
          </div>
          <div class="admin-compose" id="admin-compose">
            <input class="compose-input" id="compose-msg" type="text" placeholder="Announcement message…" />
            <input class="compose-input short" id="compose-link-text" type="text" placeholder="Link text (optional)" />
            <input class="compose-input short" id="compose-url" type="text" placeholder="URL (optional)" />
            <select class="compose-select" id="compose-type">
              <option value="info">Info</option>
              <option value="urgent">Urgent</option>
            </select>
            <button class="compose-btn post" id="compose-post">Post</button>
            <button class="compose-btn cancel" id="compose-cancel">✕</button>
          </div>
        </div>

        <!-- Announcement display bar -->
        <div class="announcement-bar empty type-info" id="ann-bar">
          <div class="slides-wrap" id="slides-wrap"></div>
          <button class="delete-btn" id="delete-btn" style="display:none" title="Delete announcement">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
          <div class="dots" id="dots"></div>
        </div>

        <!-- Read more popup -->
        <div class="ann-overlay" id="ann-overlay">
          <div class="ann-popup">
            <button class="ann-popup-close" id="ann-popup-close">✕</button>
            <div class="ann-popup-label" id="ann-popup-label">Announcement</div>
            <p class="ann-popup-text" id="ann-popup-text"></p>
          </div>
        </div>
      `;

      this._bindAdminUI();
      this._listenToAnnouncements();
      this._checkAuth();
    } catch(err) {
      console.error("TEF Announcement error:", err);
    }
  }

  _checkAuth() {
    onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      const snap = await get(ref(db, `users/${user.uid}`));
      const data = snap.val();
      if (data?.role === 'admin') {
        this._isAdmin = true;
        this.shadowRoot.getElementById('admin-bar').classList.add('visible');
        this.shadowRoot.getElementById('delete-btn').style.display = 'flex';
      }
    });
  }

  _listenToAnnouncements() {
    onValue(ref(db, 'announcements'), (snap) => {
      const raw = snap.val();
      this._announcements = raw
        ? Object.entries(raw).map(([id, v]) => ({ id, ...v }))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        : [];
      this._currentIndex = 0;
      this._render();
    });
  }

  _render() {
    const bar = this.shadowRoot.getElementById('ann-bar');
    const wrap = this.shadowRoot.getElementById('slides-wrap');
    const dots = this.shadowRoot.getElementById('dots');

    clearInterval(this._cycleTimer);
    wrap.innerHTML = '';
    dots.innerHTML = '';

    if (this._announcements.length === 0) {
      bar.classList.add('empty');
      return;
    }

    bar.classList.remove('empty');
    this._updateBarType();

    this._announcements.forEach((ann, i) => {
      const slide = document.createElement('div');
      slide.className = 'slide' + (i === 0 ? ' active' : '');
      slide.dataset.index = i;

      const badge = `<span class="slide-badge">${ann.type === 'urgent' ? '⚠ Urgent' : 'Info'}</span>`;

      // Truncate if over 80 chars
      const fullText = ann.message;
      const isTruncated = fullText.length > 80;
      const displayText = isTruncated ? fullText.substring(0, 80) + '…' : fullText;
      const text = `<span class="slide-text">
        ${displayText}
        ${isTruncated ? `<button class="read-more-btn" data-full="${fullText.replace(/"/g, '&quot;')}" data-type="${ann.type}">Read more</button>` : ''}
      </span>`;

      const link = ann.url
        ? `<a class="slide-link" href="${ann.url}" target="_blank" rel="noopener">${ann.linkText || 'Learn more'} →</a>`
        : '';

      slide.innerHTML = badge + text + link;
      wrap.appendChild(slide);

      const dot = document.createElement('div');
      dot.className = 'dot' + (i === 0 ? ' active' : '');
      dots.appendChild(dot);
    });

    dots.style.display = this._announcements.length > 1 ? 'flex' : 'none';

    if (this._announcements.length > 1) {
      this._cycleTimer = setInterval(() => this._nextSlide(), 4500);
    }
    this._bindClickCycle();
  }

  _nextSlide() {
    const slides = this.shadowRoot.querySelectorAll('.slide');
    const dotEls = this.shadowRoot.querySelectorAll('.dot');

    slides[this._currentIndex]?.classList.remove('active');
    dotEls[this._currentIndex]?.classList.remove('active');

    this._currentIndex = (this._currentIndex + 1) % this._announcements.length;

    slides[this._currentIndex]?.classList.add('active');
    dotEls[this._currentIndex]?.classList.add('active');

    this._updateBarType();
  }

  _updateBarType() {
    const bar = this.shadowRoot.getElementById('ann-bar');
    const ann = this._announcements[this._currentIndex];
    if (!ann) return;
    bar.classList.remove('type-info', 'type-urgent');
    bar.classList.add(ann.type === 'urgent' ? 'type-urgent' : 'type-info');
  }

  _bindClickCycle() {
    const wrap = this.shadowRoot.getElementById('slides-wrap');
    wrap.addEventListener('click', (e) => {
      // Don't cycle if they clicked a button or link
      if (e.target.closest('button, a')) return;
      if (this._announcements.length <= 1) return;
      clearInterval(this._cycleTimer);
      this._nextSlide();
      // Restart auto-cycle after manual click
      this._cycleTimer = setInterval(() => this._nextSlide(), 4500);
    });
  }

  _bindAdminUI() {
    const trigger = this.shadowRoot.getElementById('admin-trigger');
    const compose = this.shadowRoot.getElementById('admin-compose');
    const cancelBtn = this.shadowRoot.getElementById('compose-cancel');
    const postBtn = this.shadowRoot.getElementById('compose-post');
    const deleteBtn = this.shadowRoot.getElementById('delete-btn');

    trigger.addEventListener('click', () => {
      trigger.style.display = 'none';
      compose.classList.add('open');
      this.shadowRoot.getElementById('compose-msg').focus();
    });

    cancelBtn.addEventListener('click', () => {
      compose.classList.remove('open');
      trigger.style.display = 'flex';
      this._clearCompose();
    });

    postBtn.addEventListener('click', async () => {
      const msg = this.shadowRoot.getElementById('compose-msg').value.trim();
      if (!msg) return;

      const linkText = this.shadowRoot.getElementById('compose-link-text').value.trim();
      const url = this.shadowRoot.getElementById('compose-url').value.trim();
      const type = this.shadowRoot.getElementById('compose-type').value;

      const entry = { message: msg, type, createdAt: Date.now() };
      if (linkText) entry.linkText = linkText;
      if (url) entry.url = url;

      await push(ref(db, 'announcements'), entry);

      compose.classList.remove('open');
      trigger.style.display = 'flex';
      this._clearCompose();
    });

    deleteBtn.addEventListener('click', async () => {
      const ann = this._announcements[this._currentIndex];
      if (!ann) return;
      if (!confirm('Delete this announcement?')) return;
      await remove(ref(db, `announcements/${ann.id}`));
    });

    // Read more popup handlers
    this.shadowRoot.addEventListener('click', (e) => {
      if (e.target.classList.contains('read-more-btn')) {
        this.shadowRoot.getElementById('ann-popup-text').textContent = e.target.dataset.full;
        this.shadowRoot.getElementById('ann-popup-label').textContent =
          e.target.dataset.type === 'urgent' ? '⚠ Urgent Announcement' : 'Announcement';
        this.shadowRoot.getElementById('ann-overlay').classList.add('open');
      }
      if (e.target.id === 'ann-popup-close' || e.target.id === 'ann-overlay') {
        this.shadowRoot.getElementById('ann-overlay').classList.remove('open');
      }
    });
  }

  _clearCompose() {
    this.shadowRoot.getElementById('compose-msg').value = '';
    this.shadowRoot.getElementById('compose-link-text').value = '';
    this.shadowRoot.getElementById('compose-url').value = '';
    this.shadowRoot.getElementById('compose-type').value = 'info';
  }

  disconnectedCallback() {
    clearInterval(this._cycleTimer);
  }
}

customElements.define('tef-announcement', TEFAnnouncement);