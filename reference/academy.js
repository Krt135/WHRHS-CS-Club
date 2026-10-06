import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getDatabase, ref, push, set, onValue, remove, update, get } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-database.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { firebaseConfig } from './config.js';
import { profileAvatarHtml } from "./profile-link.js";
import { softDelete } from './deletePost.js';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const storage = getStorage(app);

async function uploadFileToStorage(file, folderPath) {
  if (!file) return null;
  const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
  const sRef = storageRef(storage, `${folderPath}/${fileName}`);
  await uploadBytes(sRef, file);
  return await getDownloadURL(sRef);
}

// ── QUILL SETUP ──
const Font = Quill.import('formats/font');
Font.whitelist = [
  'arial', 'times-new-roman', 'georgia',
  'courier-new', 'verdana', 'trebuchet-ms', 'palatino', 'garamond'
];
Quill.register(Font, true);

const QuillSize = Quill.import('attributors/style/size');
QuillSize.whitelist = ['10px', '12px', '14px', '18px', '24px', '32px'];
Quill.register(QuillSize, true);

const QUILL_TOOLBAR = [
  ['bold', 'italic', 'underline'],
  [{
    font: [
      false,
      'arial', 'times-new-roman', 'georgia',
      'courier-new', 'verdana', 'trebuchet-ms', 'palatino', 'garamond'
    ]
  }],
  [{ size: ['10px', '12px', '14px', false, '18px', '24px', '32px'] }],
  ['link', 'image'],
  ['clean']
];

// Inline Image Handler for Firebase Storage
function quillImageHandler() {
  const input = document.createElement('input');
  input.setAttribute('type', 'file');
  input.setAttribute('accept', 'image/*');
  input.click();

  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;

    const editor = this.quill;
    const range = editor.getSelection(true);

    try {
      const imgRef = storageRef(storage, `inline_images/${Date.now()}_${file.name}`);
      const snapshot = await uploadBytes(imgRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);

      editor.insertEmbed(range.index, 'image', downloadURL);
      editor.setSelection(range.index + 1);
    } catch (error) {
      console.error("Image upload failed:", error);
      alert("Failed to upload image. Please try again.");
    }
  };
}

const cQuill = new Quill('#cEditor', {
  theme: 'snow',
  modules: {
    toolbar: {
      container: QUILL_TOOLBAR,
      handlers: { image: quillImageHandler }
    }
  },
  placeholder: 'Write your lesson here in simple, accessible language…'
});

const eQuill = new Quill('#eEditor', {
  theme: 'snow',
  modules: {
    toolbar: {
      container: QUILL_TOOLBAR,
      handlers: { image: quillImageHandler }
    }
  },
  placeholder: 'Edit your lesson content…'
});

cQuill.on('text-change', () => {
  const text = cQuill.getText();
  document.getElementById('cWC').textContent =
    (text.trim() ? text.trim().split(/\s+/).length : 0) + ' words';
});
eQuill.on('text-change', () => {
  const text = eQuill.getText();
  document.getElementById('eWC').textContent =
    (text.trim() ? text.trim().split(/\s+/).length : 0) + ' words';
});

// ─────────────────────────────────────────────
//  AUTH STATE
// ─────────────────────────────────────────────

let currentUser = null;
let userRole = "public";
let userProfile = null;

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const snapshot = await get(ref(db, `users/${user.uid}`));
    if (snapshot.exists()) {
      userProfile = snapshot.val();
      userRole = userProfile.role || "member";
    }
  } else {
    currentUser = null;
    userRole = "public";
    userProfile = null;
  }
  if (currentId) renderLesson(); else renderList();
});

function getDisplayName(user) {
  if (userProfile && userProfile.displayName) return userProfile.displayName;
  return user.email.split('@')[0];
}

// ─────────────────────────────────────────────
//  CONSTANTS / HELPERS
// ─────────────────────────────────────────────

const ICONS = { macro: "📊", micro: "🏪", trade: "🌍", money: "💵", markets: "📈", policy: "🏛️" };
function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function rel(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " hours ago"; return Math.floor(s / 86400) + " days ago";
}
function wdCt(s) { return s.trim() ? s.trim().split(/\s+/).length : 0; }

function myLiked(l) { return !!(currentUser && l.userLikes && l.userLikes[currentUser.uid]); }
function myDisliked(l) { return !!(currentUser && l.userDislikes && l.userDislikes[currentUser.uid]); }

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────

let lessons = {};
let currentId = null;
let topicFilter = "all";
let levelFilter = "all";
let sortMode = "newest";
let quizState = {};
let qbQuestions = [];

// Cover image state (single file)
let createCoverFile = null;   // File, or null
let editCoverFile = null;     // File, existing url string, or null
let editCoverRemoved = false; // true if the user removed the existing cover during edit

// Attachment state (multiple files)
let createDocs = [];  // array of File
let editDocs = [];    // array of File or existing {name, url}

function handleCoverFile(input, type) {
  const file = input.files[0];
  if (!file) return;

  if (type === 'c') {
    createCoverFile = file;
  } else {
    editCoverFile = file;
    editCoverRemoved = false;
  }

  input.value = '';
  renderCoverPreview(type);
}

function renderCoverPreview(type) {
  const containerId = type === 'c' ? 'cImgPreviewContainer' : 'eImgPreviewContainer';
  const container = document.getElementById(containerId);
  if (!container) return;
  const coverValue = type === 'c' ? createCoverFile : editCoverFile;

  container.innerHTML = '';

  if (!coverValue) {
    container.style.display = 'none';
    return;
  }

  const src = coverValue instanceof File ? URL.createObjectURL(coverValue) : coverValue;
  container.style.display = 'block';

  const wrap = document.createElement('div');
  wrap.style.cssText = "position:relative; width:160px; max-width:100%;";
  wrap.innerHTML = `
    <img src="${src}" style="width:100%; display:block; border-radius:8px; border:1px solid #d9c9a3;" alt="Cover preview">
    <button type="button" onclick="window.removeCoverImage('${type}')"
      style="position:absolute; top:-8px; right:-8px; background:#ff4d4d; color:white; border:none; border-radius:50%; width:20px; height:20px; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:12px; padding:0;">✕</button>
  `;
  container.appendChild(wrap);
}

function removeCoverImage(type) {
  if (type === 'c') {
    createCoverFile = null;
  } else {
    editCoverFile = null;
    editCoverRemoved = true;
  }
  renderCoverPreview(type);
}

function handleMultipleFiles(input, type, category) {
  const files = Array.from(input.files);
  if (!files.length) return;

  if (type === 'c' && category === 'doc') createDocs.push(...files);
  if (type === 'e' && category === 'doc') editDocs.push(...files);

  input.value = '';
  renderPreviews(type, category);
}

function renderPreviews(type, category) {
  let array = [];
  let containerId = '';

  if (type === 'c' && category === 'doc') { array = createDocs; containerId = 'cDocPreviewContainer'; }
  if (type === 'e' && category === 'doc') { array = editDocs; containerId = 'eDocPreviewContainer'; }

  const container = document.getElementById(containerId);
  if (!container) return;

  if (!array.length) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'flex';
  container.innerHTML = array.map((item, index) => {
    const name = item instanceof File ? item.name : (item.name || 'File');
    return `
      <div style="display:flex; align-items:center; gap:6px; padding:6px 10px; background:#f3ede0; border:1px solid #d9c9a3; border-radius:20px; font-size:12px; color:#5a4a32;">
        <span>📄 ${name}</span>
        <button type="button" onclick="window.removeFile(${index}, '${type}', '${category}')"
          style="background:none; border:none; cursor:pointer; color:#a04040; font-weight:bold; padding:0; line-height:1;">✕</button>
      </div>`;
  }).join('');
}

function removeFile(index, type, category) {
  if (type === 'c' && category === 'doc') createDocs.splice(index, 1);
  if (type === 'e' && category === 'doc') editDocs.splice(index, 1);
  renderPreviews(type, category);
}

// ─────────────────────────────────────────────
//  FIREBASE LISTENER
// ─────────────────────────────────────────────

onValue(ref(db, "lessons"), snapshot => {
  lessons = snapshot.val() || {};
  if (currentId) {
    if (lessons[currentId]) renderLesson();
    else showList();
  } else { renderList(); }
});

// ─────────────────────────────────────────────
//  MODAL HELPERS
// ─────────────────────────────────────────────

function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }
document.querySelectorAll(".modal-overlay").forEach(o =>
  o.addEventListener("click", e => { if (e.target === o) o.classList.remove("open"); })
);

// ─────────────────────────────────────────────
//  VIEWS
// ─────────────────────────────────────────────

function showList() {
  currentId = null; quizState = {};
  document.getElementById("viewList").classList.add("active");
  document.getElementById("viewLesson").classList.remove("active");
  renderList();
}

function showLesson(firebaseKey) {
  currentId = firebaseKey; quizState = {};
  document.getElementById("viewList").classList.remove("active");
  document.getElementById("viewLesson").classList.add("active");
  renderLesson();
}

// ─────────────────────────────────────────────
//  FILTER / SORT
// ─────────────────────────────────────────────

function setTopicFilter(btn, val) {
  topicFilter = val;
  document.querySelectorAll(".filter-chip").forEach(b => b.classList.remove("active"));
  btn.classList.add("active"); renderList();
}

function setLevelFilter(btn, val) {
  levelFilter = val;
  document.querySelectorAll(".level-chip").forEach(b => b.classList.remove("active"));
  btn.classList.add("active"); renderList();
}

// ─────────────────────────────────────────────
//  RENDER LIST
// ─────────────────────────────────────────────

function renderList() {
  const q = (document.getElementById("searchInput")?.value || "").toLowerCase();
  let items = Object.entries(lessons).map(([key, val]) => ({ ...val, _key: key }));
  if (topicFilter !== "all") items = items.filter(l => l.topic === topicFilter);
  if (levelFilter !== "all") items = items.filter(l => l.level === levelFilter);
  if (q) items = items.filter(l =>
    l.title.toLowerCase().includes(q) ||
    l.topic.includes(q) ||
    l.level.toLowerCase().includes(q) ||
    (l.desc || "").toLowerCase().includes(q)
  );
  if (sortMode === "oldest") items.sort((a, b) => a.postedAt - b.postedAt);
  else if (sortMode === "popular") items.sort((a, b) => (b.likes || 0) - (a.likes || 0));
  else items.sort((a, b) => b.postedAt - a.postedAt);

  const el = document.getElementById("lessonsList");
  if (!items.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-italic">Educational lessons coming soon.</div><div class="empty-sub">Exec members will publish simplified economics lessons here.</div></div>`;
    return;
  }
  el.innerHTML = items.map(l => {
    const iconBg = { Beginner: "#dcfce7", Intermediate: "#fef3c7", Advanced: "#fee2e2" }[l.level] || "#f3f4f6";
    const rawText = l.richText ? (l.contentText || '') : (l.content || '');
    const readMin = Math.max(1, Math.round(wdCt(rawText) / 130));
    const commentCount = l.comments ? Object.keys(l.comments).length : 0;
    return `
    <div class="lesson-card" onclick="showLesson('${l._key}')">
      <div class="lc-top">
        <div class="lc-icon" style="background:${iconBg}">${esc(l.icon || ICONS[l.topic] || "📚")}</div>
        <div class="lc-badges">
          <span class="level-badge ${l.level.toLowerCase()}">${esc(l.level)}</span>
          <span class="topic-badge">${esc(l.topic)}</span>
        </div>
      </div>
      <div class="lc-title">${esc(l.title)}</div>
      <div class="lc-desc">${esc(l.desc || "")}</div>
      <div class="lc-footer">
        <div class="lc-meta">
          <span>${rel(l.postedAt)}</span><span>·</span>
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          ${commentCount}
        </div>
        <span class="lc-read">~${readMin} min read</span>
      </div>
      ${l.author ? `<div class="lc-author" style="font-size:12px;color:var(--text-muted);margin-top:6px">By ${esc(l.author)}</div>` : ''}
    </div>`;
  }).join("");
}

// ─────────────────────────────────────────────
//  RENDER LESSON
// ─────────────────────────────────────────────

function renderLesson() {
  const l = lessons[currentId]; if (!l) return showList();

  function parseContent(raw) {
    return (raw || "").split(/\n\n+/).map(para => {
      para = para.trim();
      if (para.startsWith("===")) { const h = para.replace(/^===\s*/, "").replace(/\s*===$/, ""); return `<h3>${esc(h)}</h3>`; }
      if (para.startsWith("[EXAMPLE]")) { const inner = para.replace("[EXAMPLE]", "").replace("[/EXAMPLE]", "").trim(); return `<div class="example-box"><strong>EXAMPLE</strong>${esc(inner)}</div>`; }
      return `<p>${esc(para)}</p>`;
    }).join("");
  }

  const lessonHtml = l.richText
    ? (l.contentHtml || '')
    : parseContent(l.content || '');

  const rawText = l.richText ? (l.contentText || '') : (l.content || '');
  const readMin = Math.max(1, Math.round(wdCt(rawText) / 130));

  const iLiked = myLiked(l);
  const iDisliked = myDisliked(l);

  const imgHtml = l.imageUrl ? `<img src="${l.imageUrl}" style="max-width:100%; border-radius:8px; margin: 16px 0;">` : '';
  const docsHtml = (l.documents && l.documents.length)
    ? `<div style="margin: 16px 0; display:flex; flex-direction:column; gap:8px;">
        ${l.documents.map(doc => `<a href="${doc.url}" download="${esc(doc.name || 'attachment')}" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; gap:8px; width:fit-content; padding: 12px; background: #f3f4f6; border-radius: 6px; font-weight:bold; color:var(--primary); text-decoration:none;">📎 ${esc(doc.name || 'Attachment')}</a>`).join('')}
      </div>`
    : '';
  const fileHtml = l.fileUrl ? `<div style="margin: 16px 0; padding: 12px; background: #f3f4f6; border-radius: 6px;"><a href="${l.fileUrl}" target="_blank" style="font-weight:bold; color:var(--primary); text-decoration:none;">📎 Download Attached File: ${l.fileName || 'Attachment'}</a></div>` : '';

  const qs = Array.isArray(l.quiz) ? l.quiz : [];
  let quizHtml = "";
  if (qs.length) {
    const qi = quizState.qi || 0, score = quizState.score || 0, done = quizState.done || false;
    if (done) {
      const pct = Math.round(score / qs.length * 100);
      const icon = pct === 100 ? "🏆" : pct >= 70 ? "🎯" : "📚";
      quizHtml = `<div class="quiz-section"><div class="quiz-header">✅ COMPREHENSION CHECK</div><div class="quiz-body"><div class="quiz-done">
        <div class="quiz-done-icon">${icon}</div>
        <div class="quiz-done-title">${pct === 100 ? "Perfect!" : pct >= 70 ? "Well done!" : "Keep studying!"}</div>
        <div class="quiz-done-score">${score} / ${qs.length} correct · ${pct}%</div>
        <button class="quiz-retry" onclick="quizState={};renderLesson()">Try Again</button>
      </div></div></div>`;
    } else {
      const q = qs[qi], answered = quizState.answered || false, chosen = quizState.chosen;
      quizHtml = `<div class="quiz-section">
        <div class="quiz-header" style="justify-content:space-between">
          <span>📝 COMPREHENSION CHECK</span><span class="quiz-score">Q${qi + 1} of ${qs.length} · ${score} correct</span>
        </div>
        <div class="quiz-body">
          <div class="quiz-q">${esc(q.q)}</div>
          <div class="quiz-options">
            ${(q.opts || []).map((o, i) => { let cls = "quiz-opt"; if (answered) cls += i === q.correct ? " correct" : i === chosen ? " wrong" : " dimmed"; return `<button class="${cls}" ${answered ? "disabled" : ""} onclick="answerQuiz(${i})">${esc(o)}</button>`; }).join("")}
          </div>
          <div class="quiz-feedback ${answered ? "visible" : ""}">
            <strong>${answered && chosen === q.correct ? "✓ Correct! " : "✗ Not quite. "}</strong>
            ${answered ? esc(q.exp || "") : ""}
          </div>
          <button class="quiz-next ${answered ? "visible" : ""}" onclick="nextQuiz()">
            ${qi + 1 < qs.length ? "Next Question →" : "See Results →"}
          </button>
        </div>
      </div>`;
    }
  }

  const commentEntries = l.comments
    ? Object.entries(l.comments).map(([k, v]) => ({ ...v, _key: k })).sort((a, b) => a.postedAt - b.postedAt)
    : [];

  const canEdit = currentUser && l.authorId === currentUser.uid;
  const canDelete = currentUser && (l.authorId === currentUser.uid || userRole === 'admin');

  const commentsHtml = commentEntries.length
    ? commentEntries.map(c => {
      const totalCommentLikes = c.userLikes ? Object.keys(c.userLikes).length : 0;
      const amILiked = currentUser && c.userLikes && c.userLikes[currentUser.uid];
      const canDeleteComment = currentUser && (c.authorId === currentUser.uid || userRole === 'admin');
      return `
        <div class="comment-item">
          ${profileAvatarHtml(c.authorId, "div", "comment-av", "", esc(c.initials || "?"), { role: c.authorRole || "member" })}
          <div class="comment-bubble">
            <div class="comment-hdr">
              <span class="comment-author">${esc(c.author)}</span>
              <span class="comment-time">${rel(c.postedAt)}</span>
            </div>
            <div class="comment-text">${esc(c.text)}</div>
            <div class="comment-acts">
              <button class="cmt-act ${amILiked ? "liked" : ""}" onclick="likeComment('${currentId}','${c._key}')">
                <svg width="12" height="12" fill="${amILiked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 002 2.3H14z"/></svg>
                ${totalCommentLikes}
              </button>
              ${canDeleteComment ? `
              <button class="cmt-act cmt-del" onclick="deleteComment('${currentId}','${c._key}')">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                Delete
              </button>`: ''}
            </div>
          </div>
        </div>`;
    }).join("")
    : `<p style="font-style:italic;color:#9ca3af;font-size:15px">No comments yet — ask a question or leave a thought!</p>`;

  document.getElementById("lessonTopActions").innerHTML = `
  ${canEdit ? `
    <button class="topbar-btn btn-edit-tb" onclick="openEditModal()">
      <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit
    </button>` : ""}
  ${canDelete ? `
    <button class="topbar-btn btn-del-tb" onclick="openModal('confirmModal')">
      <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>Delete
    </button>` : ""}`;

  const concepts = Array.isArray(l.concepts) ? l.concepts : [];

document.getElementById("lessonBody").innerHTML = `
    <div class="lesson-eyebrow">THE ACADEMY · ${esc(l.topic.toUpperCase())} · <span class="level-badge ${l.level.toLowerCase()}">${esc(l.level)}</span></div>
    <div class="lesson-hero-icon">${esc(l.icon || ICONS[l.topic] || "📚")}</div>
    <div class="lesson-title">${esc(l.title)}</div>
    <div class="lesson-meta-row">
      ${l.author ? `<span style="font-size:13px;color:var(--text-muted)">By <strong>${esc(l.author)}</strong></span><span style="font-size:13px;color:var(--text-muted)">·</span>` : ''}
      <span style="font-size:13px;color:var(--text-muted)">${rel(l.postedAt)}</span>
      <span style="font-size:13px;color:var(--text-muted)">·</span>
      <span style="font-size:13px;color:var(--text-muted)">~${readMin} min read</span>
      <span style="font-size:13px;color:var(--text-muted)">·</span>
      <span style="font-size:13px;color:var(--text-muted)">${commentEntries.length} comment${commentEntries.length !== 1 ? "s" : ""}</span>
    </div>
    ${concepts.length ? `<div class="key-concepts"><div class="kc-title">KEY CONCEPTS IN THIS LESSON</div><ul class="kc-list">${concepts.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}
    <div class="lesson-divider"></div>
    ${imgHtml}
    ${docsHtml}
    ${fileHtml}
    <div class="lesson-content">${lessonHtml}</div>
    ${quizHtml}
    <div class="lesson-reaction">
      <button class="react-btn ${iLiked ? "liked" : ""}" onclick="reactLesson('like')">
        👍 Helpful (${l.likes || 0})
      </button>
      <button class="react-btn ${iDisliked ? "disliked" : ""}" onclick="reactLesson('dislike')">
        👎 Not Helpful (${l.dislikes || 0})
      </button>
    </div>
    <div class="comments-area">
      <div class="comments-title">💬 ${commentEntries.length} Comment${commentEntries.length !== 1 ? "s" : ""}</div>
      ${commentsHtml}
      <div class="new-comment-box" style="margin-top:16px">
        <textarea class="new-comment-input" id="cmtInput" placeholder="Ask a question or leave a comment..."></textarea>
        <button class="btn-post-cmt" onclick="postComment()">Post</button>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────
//  PUBLISH LESSON
// ─────────────────────────────────────────────

async function publishLesson() {
  if (!currentUser) return alert("Please log in to post.");

  const title = document.getElementById("cTitle").value.trim();
  const contentHtml = cQuill.root.innerHTML;
  const contentText = cQuill.getText().trim();

  if (!title) { document.getElementById("cTitle").focus(); return; }
  if (!contentText) { cQuill.focus(); return; }

  const name = getDisplayName(currentUser);
  const initials = name.substring(0, 2).toUpperCase();
  const concepts = document.getElementById("cConcepts").value.split("\n").map(s => s.trim()).filter(Boolean);
  const validQuiz = qbQuestions.filter(q => q.q && q.opts.filter(Boolean).length >= 2);

  const imgFile = createCoverFile;

  const imageUrl = await uploadFileToStorage(imgFile, 'academy_images');

  const documents = [];
  for (const file of createDocs) {
    const url = await uploadFileToStorage(file, 'academy_files');
    documents.push({ name: file.name, url });
  }

  const newRef = push(ref(db, "lessons"));
  await set(newRef, {
    icon: document.getElementById("cIcon").value.trim() || ICONS[document.getElementById("cTopic").value] || "📚",
    title,
    topic: document.getElementById("cTopic").value,
    level: document.getElementById("cLevel").value,
    desc: document.getElementById("cDesc").value.trim() || title,
    concepts,
    richText: true,
    contentHtml,      
    contentText,      
    quiz: validQuiz,
    imageUrl,
    documents,
    author: name, authorInitials: initials, authorId: currentUser.uid,
    postedAt: Date.now(), likes: 0, dislikes: 0
  });

  ["cTitle", "cDesc", "cIcon", "cConcepts"].forEach(id => document.getElementById(id).value = "");
  cQuill.setContents([]);
  document.getElementById("cWC").textContent = "0 words";
  createCoverFile = null;
  createDocs = [];
  renderCoverPreview('c');
  renderPreviews('c', 'doc');
  qbQuestions = []; renderQuizBuilder(); closeModal("createModal");
}

// ─────────────────────────────────────────────
//  EDIT / DELETE LESSON
// ─────────────────────────────────────────────

function openEditModal() {
  const l = lessons[currentId]; if (!l) return;
  document.getElementById("eTitle").value = l.title;
  document.getElementById("eTopic").value = l.topic;
  document.getElementById("eLevel").value = l.level;
  document.getElementById("eIcon").value = l.icon || "";
  document.getElementById("eDesc").value = l.desc || "";
  document.getElementById("eConcepts").value = (Array.isArray(l.concepts) ? l.concepts : []).join("\n");
  editCoverFile = l.imageUrl || null;
  editCoverRemoved = false;
  editDocs = l.documents ? [...l.documents] : (l.fileUrl ? [{ name: l.fileName || 'Attachment', url: l.fileUrl }] : []);

  renderCoverPreview('e');
  renderPreviews('e', 'doc');

  if (l.richText) {
    eQuill.clipboard.dangerouslyPasteHTML(l.contentHtml || '');
  } else {
    eQuill.setText(l.content || '');
  }

  const rawText = l.richText ? (l.contentText || '') : (l.content || '');
  document.getElementById("eWC").textContent = wdCt(rawText) + " words";
  openModal("editModal");
}

async function saveEdit() {
  const l = lessons[currentId]; if (!l) return;

  const contentHtml = eQuill.root.innerHTML;
  const contentText = eQuill.getText().trim();
  if (!contentText) { eQuill.focus(); return; }

  const concepts = document.getElementById("eConcepts").value.split("\n").map(s => s.trim()).filter(Boolean);

  const updates = {
    title: document.getElementById("eTitle").value.trim() || l.title,
    topic: document.getElementById("eTopic").value,
    level: document.getElementById("eLevel").value,
    icon: document.getElementById("eIcon").value.trim() || ICONS[document.getElementById("eTopic").value] || "📚",
    desc: document.getElementById("eDesc").value.trim() || l.desc,
    concepts,
    richText: true,
    contentHtml,
    contentText
  };

  const imgFile = editCoverFile instanceof File ? editCoverFile : null;

  // Cover image: upload a new file, keep the existing one, or clear it if removed
  if (imgFile) {
    updates.imageUrl = await uploadFileToStorage(imgFile, 'academy_images');
  } else if (editCoverRemoved) {
    updates.imageUrl = null;
  } else if (typeof editCoverFile === 'string') {
    updates.imageUrl = editCoverFile;
  }

  // Documents: upload new files, keep existing ones
  const finalDocs = [];
  for (const item of editDocs) {
    if (item instanceof File) {
      const url = await uploadFileToStorage(item, 'academy_files');
      finalDocs.push({ name: item.name, url });
    } else {
      finalDocs.push(item);
    }
  }
  updates.documents = finalDocs;
  updates.fileUrl = null;
  updates.fileName = null;

  await update(ref(db, `lessons/${currentId}`), updates);
  editCoverFile = null;
  editCoverRemoved = false;
  editDocs = [];
  closeModal("editModal");
}

async function deleteLesson() {
  await softDelete('lessons', currentId);
  closeModal("confirmModal"); showList();
}

// ─────────────────────────────────────────────
//  REACTIONS (per-user)
// ─────────────────────────────────────────────

async function reactLesson(type) {
  if (!currentUser) return alert("Please log in to react.");
  const l = lessons[currentId]; if (!l) return;

  const uid = currentUser.uid;
  const wasLiked = !!(l.userLikes && l.userLikes[uid]);
  const wasDisliked = !!(l.userDislikes && l.userDislikes[uid]);
  let likes = l.likes || 0;
  let dislikes = l.dislikes || 0;

  const lessonRef = ref(db, `lessons/${currentId}`);
  const updates = {};

  if (type === "like") {
    if (wasLiked) { updates[`userLikes/${uid}`] = null; likes--; }
    else {
      updates[`userLikes/${uid}`] = true; likes++;
      if (wasDisliked) { updates[`userDislikes/${uid}`] = null; dislikes--; }
    }
  } else {
    if (wasDisliked) { updates[`userDislikes/${uid}`] = null; dislikes--; }
    else {
      updates[`userDislikes/${uid}`] = true; dislikes++;
      if (wasLiked) { updates[`userLikes/${uid}`] = null; likes--; }
    }
  }

  updates['likes'] = likes;
  updates['dislikes'] = dislikes;

  try {
    await update(lessonRef, updates);
  } catch (error) {
    console.error("Failed to update reaction:", error);
    alert("You don't have permission to do that.");
  }
}

// ─────────────────────────────────────────────
//  COMMENTS
// ─────────────────────────────────────────────

async function postComment() {
  if (!currentUser) return alert("Please log in to comment.");
  const inp = document.getElementById("cmtInput");
  if (!inp || !inp.value.trim()) return;
  const name = getDisplayName(currentUser);
  const cmtRef = push(ref(db, `lessons/${currentId}/comments`));
  await set(cmtRef, {
    author: name, initials: name.substring(0, 2).toUpperCase(),
    authorId: currentUser.uid, authorRole: userRole, text: inp.value.trim(),
    postedAt: Date.now(), likes: 0, liked: false
  });
  inp.value = "";
}

async function likeComment(lessonKey, commentKey) {
  if (!currentUser) { alert("Please log in to like comments."); return; }
  const uid = currentUser.uid;
  const l = lessons[lessonKey];
  const c = l && l.comments ? l.comments[commentKey] : null;
  if (!c) return;
  const hasLiked = c.userLikes && c.userLikes[uid];
  const likeRef = ref(db, `lessons/${lessonKey}/comments/${commentKey}/userLikes/${uid}`);
  if (hasLiked) { await remove(likeRef); } else { await set(likeRef, true); }
}

async function deleteComment(lessonKey, commentKey) {
  if (confirm("Delete this comment?")) await remove(ref(db, `lessons/${lessonKey}/comments/${commentKey}`));
}

// ─────────────────────────────────────────────
//  QUIZ
// ─────────────────────────────────────────────

function answerQuiz(i) {
  const l = lessons[currentId]; if (!l) return;
  const q = (l.quiz || [])[quizState.qi || 0];
  if (quizState.answered) return;
  quizState.answered = true; quizState.chosen = i;
  if (i === q.correct) quizState.score = (quizState.score || 0) + 1;
  renderLesson();
}

function nextQuiz() {
  const l = lessons[currentId]; if (!l) return;
  const qi = (quizState.qi || 0) + 1;
  if (qi >= (l.quiz || []).length) { quizState.done = true; }
  else { quizState.qi = qi; quizState.answered = false; quizState.chosen = undefined; }
  renderLesson();
}

// ─────────────────────────────────────────────
//  QUIZ BUILDER
// ─────────────────────────────────────────────

function addQuizQuestion() { qbQuestions.push({ q: "", opts: ["", "", "", ""], correct: 0, exp: "" }); renderQuizBuilder(); }

function renderQuizBuilder() {
  const el = document.getElementById("quizBuilder");
  el.innerHTML = qbQuestions.map((qq, qi) => `
    <div class="qb-question">
      <div class="qb-q-label">Question ${qi + 1}</div>
      <input class="form-input" style="margin-bottom:8px;font-size:14px" placeholder="Question text..." value="${esc(qq.q)}" oninput="qbQuestions[${qi}].q=this.value">
      <div class="qb-opts">
        ${qq.opts.map((o, oi) => `
          <div class="qb-opt-row">
            <input class="qb-opt-input" placeholder="Option ${oi + 1}" value="${esc(o)}" oninput="qbQuestions[${qi}].opts[${oi}]=this.value">
            <input type="radio" class="qb-correct-radio" name="correct_${qi}" ${qq.correct === oi ? "checked" : ""} onchange="qbQuestions[${qi}].correct=${oi}" title="Mark as correct">
            <span class="qb-correct-label">✓ correct</span>
          </div>`).join("")}
      </div>
      <input class="form-input" style="margin-top:8px;font-size:13px" placeholder="Explanation (shown after answering)..." value="${esc(qq.exp)}" oninput="qbQuestions[${qi}].exp=this.value">
    </div>`).join("");
}

// ─────────────────────────────────────────────
//  EXPOSE TO HTML
// ─────────────────────────────────────────────

Object.assign(window, {
  renderList, showList, showLesson, openModal, closeModal,
  setTopicFilter, setLevelFilter,
  publishLesson, openEditModal, saveEdit, deleteLesson,
  reactLesson, postComment, likeComment, deleteComment,
  answerQuiz, nextQuiz, addQuizQuestion, renderQuizBuilder,
  handleCoverFile, renderCoverPreview, removeCoverImage,
  handleMultipleFiles, renderPreviews, removeFile,
});

window.setSortMode = (val) => { sortMode = val; renderList(); };