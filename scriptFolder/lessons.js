// Member-written lessons on the Resources page (#lessons).
// List view (search, topic, level, sort) and lesson view (#lesson/<id>) with
// quiz, reactions and comments. The create/edit modal lives in
// lesson-editor.js and is only loaded when someone opens it; lesson HTML is
// cleaned by lesson-sanitize.js, loaded when a lesson is opened.
//
// Everything here is built with createElement/textContent. The only HTML
// string inserted is the lesson body, after DOMPurify.
import { onAuthStateChanged } from "firebase/auth";
import { ref, get, onValue, update, push, set, remove, serverTimestamp } from "firebase/database";
import { auth, db } from "./firebase.js";
import { TOPICS, LEVELS, LIMITS, LESSON_FORMAT, topicById, isMemberProfile, wordCount } from "./lesson-config.js";
import "../styleFolder/lessons.css";

const STORAGE_PREFIX = "https://firebasestorage.googleapis.com/v0/b/whrhs-cs-club.firebasestorage.app/o/";
const LESSON_HASH = /^#lesson\/([-\w]{1,64})$/;

const state = {
  lessons: {},
  loaded: false,
  loadError: false,
  user: null,
  profile: null,
  topic: "all",
  level: "all",
  sort: "newest",
  currentId: null,
  renderedBodyKey: null,
  quiz: {},
};

const els = {
  section: document.getElementById("lessons"),
  listView: document.getElementById("ls-list-view"),
  lessonView: document.getElementById("ls-lesson-view"),
  grid: document.getElementById("ls-grid"),
  search: document.getElementById("ls-search"),
  count: document.getElementById("ls-count"),
  sort: document.getElementById("ls-sort"),
  createSlot: document.getElementById("ls-create-slot"),
  topicChips: document.getElementById("ls-topic-chips"),
  levelChips: document.getElementById("ls-level-chips"),
  back: document.getElementById("ls-back"),
  actions: document.getElementById("ls-lesson-actions"),
  article: document.getElementById("ls-lesson"),
  confirm: document.getElementById("lsConfirmModal"),
  confirmYes: document.getElementById("ls-confirm-yes"),
  confirmError: document.getElementById("ls-confirm-error"),
};

// ─── Small DOM helpers ──────────────────────────────────────────────

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

// replaceChildren() would print null/false as text; skip them like h() does.
function fill(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
}

// Static, trusted SVG markup only.
const ICONS = {
  comment: '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  thumb: '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/><path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"/></svg>',
  trash: '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>',
  edit: '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg>',
  file: '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
};
function icon(name) {
  const tpl = document.createElement("template");
  tpl.innerHTML = ICONS[name];
  return tpl.content.firstChild;
}

// Only files from this project's own lesson folders are linked or shown.
function storageUrl(url, folder) {
  return typeof url === "string" && url.startsWith(`${STORAGE_PREFIX}${folder}%2F`) ? url : null;
}

function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || "?").slice(0, 2);
  return letters.toUpperCase();
}

function avatar(name, extraClass = "") {
  return h("span", { class: `ls-avatar ${extraClass}`.trim(), "aria-hidden": "true", text: initials(name) });
}

function relTime(ts) {
  if (!Number.isFinite(ts)) return "";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} days ago`;
  return new Date(ts).toLocaleDateString();
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return "";
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const count = (map) => (map && typeof map === "object" ? Object.keys(map).length : 0);
const readMinutes = (body) => Math.max(1, Math.round(wordCount(body.contentText) / 200));

// ─── Permissions (UI only; database.rules.json enforces them) ───────

const isMember = () => !!state.user && isMemberProfile(state.profile);
const isAdmin = () => state.profile?.role === "admin";
const isAuthor = (lesson) => !!state.user && lesson?.authorId === state.user.uid;

function authorName() {
  const name = state.profile?.displayName || state.user?.displayName || state.user?.email?.split("@")[0] || "Member";
  return name.trim().slice(0, 60) || "Member";
}

// ─── List view ──────────────────────────────────────────────────────

function lessonEntries() {
  return Object.entries(state.lessons)
    .filter(([, l]) => l && l.format === LESSON_FORMAT && l.body && typeof l.body.title === "string")
    .map(([id, l]) => ({ id, ...l }));
}

function renderChips() {
  const makeChip = (group, value, label) => h("button", {
    type: "button",
    class: "ls-chip",
    "aria-pressed": String(state[group] === value),
    onclick: () => {
      state[group] = value;
      renderChips();
      renderList();
    },
  }, label);

  fill(els.topicChips,
    h("span", { class: "ls-chip-label", text: "$ topic" }),
    makeChip("topic", "all", "All"),
    ...TOPICS.map((t) => makeChip("topic", t.id, t.label)),
  );
  fill(els.levelChips,
    h("span", { class: "ls-chip-label", text: "$ level" }),
    makeChip("level", "all", "All levels"),
    ...LEVELS.map((lvl) => makeChip("level", lvl, lvl)),
  );
}

function renderCreateSlot() {
  let content;
  if (isMember()) {
    content = h("button", { type: "button", class: "ab-btn ab-btn-accent ls-create", onclick: () => openEditor({ mode: "create" }) }, "+ Create lesson");
  } else if (state.user) {
    content = h("p", { class: "ls-note", text: "Your account is waiting for exec approval. Once approved, you can write lessons." });
  } else {
    content = h("a", { href: "login.html", class: "ab-btn ls-btn-line" }, "Sign in to create a lesson →");
  }
  els.createSlot.replaceChildren(content);
}

function renderList() {
  if (state.loadError) {
    els.grid.replaceChildren(h("div", { class: "ls-empty", text: "Couldn't load lessons. Refresh to try again." }));
    els.count.textContent = "—";
    return;
  }
  if (!state.loaded) return;

  const query = els.search.value.trim().toLowerCase();
  let items = lessonEntries();
  if (state.topic !== "all") items = items.filter((l) => l.body.topic === state.topic);
  if (state.level !== "all") items = items.filter((l) => l.body.level === state.level);
  if (query) {
    items = items.filter((l) => [
      l.body.title, l.body.desc, topicById(l.body.topic)?.label, l.body.level, l.authorName,
      ...(Array.isArray(l.body.concepts) ? l.body.concepts : []),
    ].some((field) => String(field || "").toLowerCase().includes(query)));
  }

  if (state.sort === "oldest") items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  else if (state.sort === "popular") items.sort((a, b) => count(b.userLikes) - count(a.userLikes) || (b.createdAt || 0) - (a.createdAt || 0));
  else items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  els.count.textContent = `${items.length} LESSON${items.length === 1 ? "" : "S"}`;

  if (!items.length) {
    const none = lessonEntries().length === 0;
    els.grid.replaceChildren(h("div", { class: "ls-empty" },
      none ? "No lessons yet." : "No lessons match those filters.",
      h("small", { text: none ? "Members can write the first one." : "Try another topic, level or search." }),
    ));
    return;
  }

  els.grid.replaceChildren(...items.map(lessonCard));
}

function lessonCard(l) {
  const b = l.body;
  const topic = topicById(b.topic);
  const level = LEVELS.includes(b.level) ? b.level : "Beginner";
  return h("a", { class: "ls-card", href: `#lesson/${encodeURIComponent(l.id)}` },
    h("div", { class: "ls-card-top" },
      h("span", { class: "ls-card-icon", "aria-hidden": "true", text: b.icon || topic?.icon || "📘" }),
      h("div", { class: "ls-badges" },
        h("span", { class: `ls-level ls-level-${level.toLowerCase()}`, text: level }),
        topic && h("span", { class: "ls-topic", text: topic.label }),
      ),
    ),
    h("h3", { class: "ls-card-title", text: b.title }),
    b.desc && h("p", { class: "ls-card-desc", text: b.desc }),
    h("div", { class: "ls-card-foot" },
      h("span", { class: "ls-card-author" }, avatar(l.authorName), h("span", { text: l.authorName || "Member" })),
      h("span", { class: "ls-card-meta" },
        h("span", { text: relTime(l.createdAt) }),
        h("span", { class: "ls-card-comments", title: "Comments" }, icon("comment"), String(count(l.comments))),
        h("span", { text: `~${readMinutes(b)} min` }),
      ),
    ),
  );
}

// ─── Lesson view ────────────────────────────────────────────────────

let sanitizerPromise = null;
const loadSanitizer = () => (sanitizerPromise ||= import("./lesson-sanitize.js"));

const lessonParts = {};

async function renderLesson() {
  const id = state.currentId;
  const lesson = state.lessons[id];

  if (!state.loaded) {
    els.actions.replaceChildren();
    els.article.replaceChildren(h("div", { class: "ls-empty", text: "Loading lesson…" }));
    return;
  }
  if (!lesson || lesson.format !== LESSON_FORMAT || !lesson.body) {
    state.renderedBodyKey = null;
    els.actions.replaceChildren();
    els.article.replaceChildren(h("div", { class: "ls-empty" }, "This lesson isn't available.", h("small", { text: "It may have been deleted." })));
    return;
  }

  renderActions(lesson);

  // Rebuild the article only when the lesson itself changed, so likes and
  // comments from other people don't reset the quiz or a comment draft.
  const bodyKey = `${id}:${lesson.body.updatedAt || 0}`;
  if (state.renderedBodyKey !== bodyKey) {
    const { sanitizeLessonHtml } = await loadSanitizer();
    if (state.currentId !== id) return;
    state.renderedBodyKey = bodyKey;
    buildArticle(id, lesson, sanitizeLessonHtml);
  }
  renderMeta(lesson);
  renderReactions(id, lesson);
  renderComments(id, lesson);
  renderComposer(id);
}

function renderActions(lesson) {
  const buttons = [];
  if (isAuthor(lesson)) {
    buttons.push(h("button", { type: "button", class: "ls-action", onclick: () => openEditor({ mode: "edit", id: state.currentId }) }, icon("edit"), "Edit"));
  }
  if (isAuthor(lesson) || isAdmin()) {
    buttons.push(h("button", { type: "button", class: "ls-action ls-action-danger", onclick: openDeleteConfirm }, icon("trash"), "Delete"));
  }
  els.actions.replaceChildren(...buttons);
}

function buildArticle(id, lesson, sanitize) {
  const b = lesson.body;
  const topic = topicById(b.topic);
  const level = LEVELS.includes(b.level) ? b.level : "Beginner";
  const concepts = Array.isArray(b.concepts) ? b.concepts.filter(Boolean) : [];

  const cover = storageUrl(b.cover?.url, "lesson-images");
  const files = (Array.isArray(b.attachments) ? b.attachments : [])
    .map((a) => ({ ...a, safeUrl: storageUrl(a?.url, "lesson-files") }))
    .filter((a) => a.safeUrl);

  const content = h("div", { class: "ls-content" });
  content.innerHTML = sanitize(b.contentHtml);

  lessonParts.meta = h("div", { class: "ls-meta" });
  lessonParts.quiz = h("div", { class: "ls-quiz-wrap" });
  lessonParts.reactions = h("div", { class: "ls-reactions" });
  lessonParts.comments = h("div", { class: "ls-comment-list" });
  lessonParts.commentsTitle = h("h2", { class: "ls-comments-title" });
  lessonParts.composer = h("div", { class: "ls-composer-slot" });

  fill(els.article,
    h("p", { class: "ls-eyebrow" },
      h("span", { text: "$ lesson" }),
      topic && h("span", { text: topic.label }),
      h("span", { class: `ls-level ls-level-${level.toLowerCase()}`, text: level }),
    ),
    h("div", { class: "ls-hero-icon", "aria-hidden": "true", text: b.icon || topic?.icon || "📘" }),
    h("h1", { class: "ls-title", text: b.title }),
    lessonParts.meta,
    concepts.length > 0 && h("div", { class: "ls-concepts" },
      h("p", { class: "ls-concepts-title", text: "$ key_concepts" }),
      h("ul", {}, ...concepts.map((c) => h("li", { text: c }))),
    ),
    h("div", { class: "ls-divider", "aria-hidden": "true" }),
    cover && h("img", { class: "ls-cover", src: cover, alt: "", loading: "lazy" }),
    files.length > 0 && h("div", { class: "ls-files" },
      h("p", { class: "ls-files-title", text: "$ attachments" }),
      ...files.map((f) => h("a", { class: "ls-file", href: f.safeUrl, target: "_blank", rel: "noopener noreferrer", download: "" },
        icon("file"),
        h("span", { class: "ls-file-name", text: f.name || "Attachment" }),
        f.size ? h("span", { class: "ls-file-size", text: formatBytes(f.size) }) : null,
      )),
    ),
    content,
    lessonParts.quiz,
    lessonParts.reactions,
    h("section", { class: "ls-comments", "aria-label": "Comments" },
      lessonParts.commentsTitle,
      lessonParts.comments,
      lessonParts.composer,
    ),
  );

  state.quiz = {};
  renderQuiz(lesson);
}

function renderMeta(lesson) {
  const comments = count(lesson.comments);
  const edited = lesson.body.updatedAt && lesson.createdAt && lesson.body.updatedAt - lesson.createdAt > 60000;
  lessonParts.meta.replaceChildren(
    h("span", { class: "ls-meta-author" }, avatar(lesson.authorName), h("span", {}, "By ", h("strong", { text: lesson.authorName || "Member" }))),
    h("span", { text: relTime(lesson.createdAt) + (edited ? " · edited" : "") }),
    h("span", { text: `~${readMinutes(lesson.body)} min read` }),
    h("span", { text: `${comments} comment${comments === 1 ? "" : "s"}` }),
  );
}

// ─── Quiz ───────────────────────────────────────────────────────────

function quizQuestions(lesson) {
  const raw = Array.isArray(lesson.body.quiz) ? lesson.body.quiz : [];
  return raw.filter((q) => q && q.q && Array.isArray(q.opts) && q.opts.filter(Boolean).length >= 2);
}

function renderQuiz(lesson) {
  const questions = quizQuestions(lesson);
  if (!questions.length) {
    lessonParts.quiz.replaceChildren();
    return;
  }
  const qs = state.quiz;
  const index = qs.index || 0;
  const score = qs.score || 0;
  const header = (right) => h("div", { class: "ls-quiz-head" }, h("span", { text: "$ quiz --check" }), right && h("span", { class: "ls-quiz-score", text: right }));

  if (qs.done) {
    const pct = Math.round((score / questions.length) * 100);
    lessonParts.quiz.replaceChildren(h("div", { class: "ls-quiz" },
      header(null),
      h("div", { class: "ls-quiz-done" },
        h("p", { class: "ls-quiz-big", text: `${score}/${questions.length}` }),
        h("p", { class: "ls-quiz-verdict", text: pct === 100 ? "Perfect score." : pct >= 70 ? "Nice work." : "Worth another read." }),
        h("p", { class: "ls-quiz-pct", text: `${pct}% correct` }),
        h("button", { type: "button", class: "ab-btn ab-btn-accent", onclick: () => { state.quiz = {}; renderQuiz(lesson); } }, "Try again"),
      ),
    ));
    return;
  }

  const q = questions[index];
  const correct = Number(q.correct);
  const answered = qs.answered === true;
  const options = q.opts.map((text, i) => ({ text, i })).filter((o) => o.text);

  fill(lessonParts.quiz, h("div", { class: "ls-quiz" },
    header(`Q${index + 1} of ${questions.length} · ${score} correct`),
    h("p", { class: "ls-quiz-q", text: q.q }),
    h("div", { class: "ls-quiz-opts" }, ...options.map(({ text, i }) => {
      let cls = "ls-quiz-opt";
      if (answered) cls += i === correct ? " is-correct" : i === qs.chosen ? " is-wrong" : " is-dim";
      return h("button", {
        type: "button", class: cls, disabled: answered,
        onclick: () => {
          state.quiz = { ...qs, answered: true, chosen: i, score: score + (i === correct ? 1 : 0) };
          renderQuiz(lesson);
        },
      }, text);
    })),
    answered && h("div", { class: "ls-quiz-feedback", role: "status" },
      h("strong", { text: qs.chosen === correct ? "Correct. " : "Not quite. " }),
      q.exp ? q.exp : null,
    ),
    answered && h("button", {
      type: "button", class: "ab-btn ab-btn-accent ls-quiz-next",
      onclick: () => {
        state.quiz = index + 1 >= questions.length
          ? { ...qs, done: true }
          : { index: index + 1, score: qs.score };
        renderQuiz(lesson);
      },
    }, index + 1 < questions.length ? "Next question →" : "See results →"),
  ));
}

// ─── Reactions ──────────────────────────────────────────────────────

function renderReactions(id, lesson) {
  const uid = state.user?.uid;
  const liked = !!(uid && lesson.userLikes?.[uid]);
  const disliked = !!(uid && lesson.userDislikes?.[uid]);
  const canReact = isMember();
  const note = canReact ? null : h("span", { class: "ls-note", text: state.user ? "Reactions open once your account is approved." : "Sign in to react." });

  fill(lessonParts.reactions,
    h("span", { class: "ls-react-label", text: "Was this helpful?" }),
    h("button", { type: "button", class: `ls-react${liked ? " is-on" : ""}`, "aria-pressed": String(liked), disabled: !canReact, onclick: () => react(id, "like") },
      "👍 Helpful", h("span", { class: "ls-react-count", text: String(count(lesson.userLikes)) })),
    h("button", { type: "button", class: `ls-react${disliked ? " is-on is-down" : ""}`, "aria-pressed": String(disliked), disabled: !canReact, onclick: () => react(id, "dislike") },
      "👎 Not helpful", h("span", { class: "ls-react-count", text: String(count(lesson.userDislikes)) })),
    note,
  );
}

async function react(id, kind) {
  const lesson = state.lessons[id];
  const uid = state.user?.uid;
  if (!lesson || !uid || !isMember()) return;
  const liked = !!lesson.userLikes?.[uid];
  const disliked = !!lesson.userDislikes?.[uid];
  // One reaction per user: setting one clears the other in the same write.
  const updates = kind === "like"
    ? { [`userLikes/${uid}`]: liked ? null : true, [`userDislikes/${uid}`]: null }
    : { [`userDislikes/${uid}`]: disliked ? null : true, [`userLikes/${uid}`]: null };
  try {
    await update(ref(db, `lessons/${id}`), updates);
  } catch (error) {
    console.error("Reaction failed:", error);
    alert("Couldn't save your reaction. Try again.");
  }
}

// ─── Comments ───────────────────────────────────────────────────────

function renderComments(id, lesson) {
  const list = Object.entries(lesson.comments || {})
    .map(([cid, c]) => ({ cid, ...c }))
    .filter((c) => typeof c.text === "string")
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  lessonParts.commentsTitle.textContent = `$ comments (${list.length})`;

  if (!list.length) {
    lessonParts.comments.replaceChildren(h("p", { class: "ls-note", text: "No comments yet. Ask a question or leave a tip." }));
    return;
  }

  const uid = state.user?.uid;
  lessonParts.comments.replaceChildren(...list.map((c) => {
    const liked = !!(uid && c.userLikes?.[uid]);
    const canDelete = !!uid && (c.authorId === uid || isAdmin());
    return h("div", { class: "ls-comment" },
      avatar(c.authorName, "ls-avatar-sm"),
      h("div", { class: "ls-comment-body" },
        h("div", { class: "ls-comment-head" },
          h("strong", { text: c.authorName || "Member" }),
          h("span", { text: relTime(c.createdAt) }),
        ),
        h("p", { class: "ls-comment-text", text: c.text }),
        h("div", { class: "ls-comment-acts" },
          h("button", {
            type: "button", class: `ls-mini${liked ? " is-on" : ""}`, "aria-pressed": String(liked),
            "aria-label": liked ? "Unlike comment" : "Like comment", disabled: !isMember(),
            onclick: () => likeComment(id, c.cid, liked),
          }, icon("thumb"), String(count(c.userLikes))),
          canDelete && h("button", {
            type: "button", class: "ls-mini ls-mini-danger",
            onclick: () => deleteComment(id, c.cid),
          }, icon("trash"), "Delete"),
        ),
      ),
    );
  }));
}

function renderComposer(id) {
  const slot = lessonParts.composer;
  const mode = isMember() ? "member" : state.user ? "pending" : "guest";
  if (slot.dataset.mode === mode && slot.dataset.lesson === id) return;
  slot.dataset.mode = mode;
  slot.dataset.lesson = id;

  if (mode === "guest") {
    slot.replaceChildren(h("a", { href: "login.html", class: "ab-btn ls-btn-line" }, "Sign in to comment →"));
    return;
  }
  if (mode === "pending") {
    slot.replaceChildren(h("p", { class: "ls-note", text: "Comments open once your account is approved." }));
    return;
  }

  const input = h("textarea", { class: "ls-comment-input", rows: "3", maxlength: String(LIMITS.comment), placeholder: "Ask a question or share a tip…", "aria-label": "Write a comment" });
  const counter = h("span", { class: "ls-counter", text: `0/${LIMITS.comment}` });
  const error = h("p", { class: "ls-error", role: "alert", hidden: true });
  const post = h("button", { type: "submit", class: "ab-btn ab-btn-accent" }, "Post →");
  input.addEventListener("input", () => { counter.textContent = `${input.value.length}/${LIMITS.comment}`; });

  const form = h("form", { class: "ls-composer" }, input, h("div", { class: "ls-composer-row" }, counter, post), error);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || post.disabled) return;
    if (text.length > LIMITS.comment) return;
    post.disabled = true;
    error.hidden = true;
    try {
      await set(push(ref(db, `lessons/${id}/comments`)), {
        authorId: state.user.uid,
        authorName: authorName(),
        text,
        createdAt: serverTimestamp(),
      });
      input.value = "";
      counter.textContent = `0/${LIMITS.comment}`;
    } catch (err) {
      console.error("Comment failed:", err);
      error.textContent = "Couldn't post your comment. Try again.";
      error.hidden = false;
    } finally {
      post.disabled = false;
    }
  });
  slot.replaceChildren(form);
}

async function likeComment(lessonId, commentId, liked) {
  const uid = state.user?.uid;
  if (!uid) return;
  try {
    const likeRef = ref(db, `lessons/${lessonId}/comments/${commentId}/userLikes/${uid}`);
    if (liked) await remove(likeRef);
    else await set(likeRef, true);
  } catch (error) {
    console.error("Comment like failed:", error);
  }
}

async function deleteComment(lessonId, commentId) {
  if (!confirm("Delete this comment?")) return;
  try {
    await remove(ref(db, `lessons/${lessonId}/comments/${commentId}`));
  } catch (error) {
    console.error("Comment delete failed:", error);
    alert("Couldn't delete that comment.");
  }
}

// ─── Delete lesson (soft delete into the admin moderation tab) ──────

function openDeleteConfirm() {
  els.confirmError.hidden = true;
  els.confirmYes.disabled = false;
  openOverlay(els.confirm);
  els.confirmYes.focus();
}

async function deleteLesson() {
  const id = state.currentId;
  const lesson = state.lessons[id];
  if (!lesson || els.confirmYes.disabled) return;
  els.confirmYes.disabled = true;
  els.confirmYes.textContent = "Deleting…";
  try {
    // Atomic move, same pattern as games/resources: admins can restore it.
    await update(ref(db), {
      [`lessons/${id}`]: null,
      [`deleted_posts/${id}`]: {
        ...lesson,
        _deletedFrom: "lessons",
        _originalId: id,
        _sourceLabel: "Lesson",
        _deletedAt: Date.now(),
        _deletedBy: authorName(),
        _deletedById: state.user.uid,
      },
    });
    closeOverlay(els.confirm);
    location.hash = "lessons";
  } catch (error) {
    console.error("Lesson delete failed:", error);
    els.confirmError.textContent = "Couldn't delete this lesson. Check that you're signed in.";
    els.confirmError.hidden = false;
    els.confirmYes.disabled = false;
  } finally {
    els.confirmYes.textContent = "Yes, delete";
  }
}

// ─── Overlays ───────────────────────────────────────────────────────

export function openOverlay(overlay) {
  overlay.classList.add("open");
  document.documentElement.classList.add("ls-lock");
}

export function closeOverlay(overlay) {
  overlay.classList.remove("open");
  if (!document.querySelector(".ls-overlay.open")) document.documentElement.classList.remove("ls-lock");
}

els.confirm?.addEventListener("click", (e) => {
  if (e.target === els.confirm || e.target.closest("[data-ls-close]")) closeOverlay(els.confirm);
});
els.confirmYes?.addEventListener("click", deleteLesson);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && els.confirm?.classList.contains("open")) closeOverlay(els.confirm);
});

// ─── Editor (lazy) ──────────────────────────────────────────────────

let editorPromise = null;

async function openEditor({ mode, id }) {
  if (!isMember()) return;
  const trigger = document.activeElement;
  try {
    editorPromise ||= import("./lesson-editor.js");
    const { openLessonEditor } = await editorPromise;
    openLessonEditor({
      mode,
      id,
      lesson: id ? state.lessons[id] : null,
      user: state.user,
      authorName: authorName(),
      onSaved: (savedId) => {
        if (location.hash === `#lesson/${savedId}`) {
          state.renderedBodyKey = null;
          renderLesson();
        } else {
          location.hash = `lesson/${savedId}`;
        }
      },
      onClose: () => trigger?.focus?.(),
    });
  } catch (error) {
    editorPromise = null;
    console.error("Couldn't load the lesson editor:", error);
    alert("Couldn't open the editor. Check your connection and try again.");
  }
}

// ─── Routing ────────────────────────────────────────────────────────

function route() {
  const match = LESSON_HASH.exec(location.hash);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const changed = state.currentId !== id;
    state.currentId = id;
    els.listView.hidden = true;
    els.lessonView.hidden = false;
    if (changed) {
      state.renderedBodyKey = null;
      els.section.scrollIntoView({ block: "start" });
    }
    renderLesson();
  } else {
    const wasOpen = state.currentId !== null;
    state.currentId = null;
    state.renderedBodyKey = null;
    els.lessonView.hidden = true;
    els.listView.hidden = false;
    renderList();
    if (wasOpen && location.hash === "#lessons") els.section.scrollIntoView({ block: "start" });
  }
}

// ─── Wiring ─────────────────────────────────────────────────────────

if (els.section) {
  renderChips();
  renderCreateSlot();

  els.search.addEventListener("input", renderList);
  els.sort.addEventListener("change", () => { state.sort = els.sort.value; renderList(); });
  els.back.addEventListener("click", () => { location.hash = "lessons"; });
  window.addEventListener("hashchange", route);

  onValue(ref(db, "lessons"), (snap) => {
    state.lessons = snap.val() || {};
    state.loaded = true;
    state.loadError = false;
    if (state.currentId) renderLesson();
    else renderList();
  }, (error) => {
    console.error("Couldn't load lessons:", error);
    state.loadError = true;
    renderList();
  });

  onAuthStateChanged(auth, async (user) => {
    state.user = user;
    state.profile = null;
    if (user) {
      try {
        state.profile = (await get(ref(db, `users/${user.uid}`))).val();
      } catch (error) {
        console.error("Couldn't load your profile:", error);
      }
    }
    renderCreateSlot();
    if (state.currentId) {
      if (lessonParts.composer) delete lessonParts.composer.dataset.mode;
      renderLesson();
    } else {
      renderList();
    }
  });

  route();
}
