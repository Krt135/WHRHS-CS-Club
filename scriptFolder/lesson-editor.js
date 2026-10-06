// Create / edit lesson modal. Loaded on demand by lessons.js so Quill (and
// its CSS) never slow down the Resources page for readers.
//
// Saving is all-or-nothing: files upload first, the lesson is written only
// if every upload succeeded, and anything uploaded by a failed attempt is
// deleted again. The button stays disabled while work is in flight.
import Quill from "quill";
import "quill/dist/quill.snow.css";
import { ref as dbRef, push, set, serverTimestamp } from "firebase/database";
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "./firebase.js";
import { sanitizeLessonHtml } from "./lesson-sanitize.js";
import { deltaToLessonHtml } from "./lesson-html.js";
import { openOverlay, closeOverlay } from "./lessons.js";
import {
  TOPICS, LEVELS, LIMITS, LESSON_FORMAT, IMAGE_TYPES, ATTACHMENT_ACCEPT,
  topicById, attachmentContentType, storageFileName, cleanDisplayName, wordCount,
} from "./lesson-config.js";

const TOOLBAR = [
  [{ header: [2, 3, false] }],
  ["bold", "italic", "underline", "strike"],
  ["code", "code-block", "blockquote"],
  [{ list: "ordered" }, { list: "bullet" }],
  ["link", "clean"],
];
const FORMATS = ["header", "bold", "italic", "underline", "strike", "code", "code-block", "blockquote", "list", "link"];

// Static markup only; user data is set through .value / textContent.
const TEMPLATE = `
<div class="rs-modal ls-modal">
  <div class="rs-modal-head">
    <h3 id="lsEditorTitle">Create <em>lesson.</em></h3>
    <button type="button" class="ls-close" data-ls-dismiss aria-label="Close">&times;</button>
  </div>
  <form class="ls-form" novalidate>
    <p class="ls-cmd" data-ls="cmd">$ lesson --new</p>

    <div class="input-group">
      <label for="ls-f-title">Lesson title</label>
      <input type="text" id="ls-f-title" maxlength="${LIMITS.title}" placeholder="e.g. Your first Pygame window" required>
    </div>

    <div class="input-row">
      <div class="input-group">
        <label for="ls-f-topic">Topic</label>
        <select id="ls-f-topic" class="ls-select">${TOPICS.map((t) => `<option value="${t.id}">${t.label}</option>`).join("")}</select>
      </div>
      <div class="input-group">
        <label for="ls-f-level">Level</label>
        <select id="ls-f-level" class="ls-select">${LEVELS.map((l) => `<option value="${l}">${l}</option>`).join("")}</select>
      </div>
    </div>

    <div class="input-row">
      <div class="input-group ls-icon-group">
        <label for="ls-f-icon">Emoji icon</label>
        <input type="text" id="ls-f-icon" class="ls-icon-input" maxlength="${LIMITS.icon}" placeholder="🎮">
      </div>
      <div class="input-group">
        <label for="ls-f-desc">Short description (shown on the card)</label>
        <input type="text" id="ls-f-desc" maxlength="${LIMITS.desc}" placeholder="One sentence: what will readers be able to build?">
      </div>
    </div>

    <div class="input-group">
      <label for="ls-f-concepts">Key concepts (one per line)</label>
      <textarea id="ls-f-concepts" rows="3" placeholder="Game loop&#10;Sprites and collision&#10;Frame rate"></textarea>
    </div>

    <div class="input-group">
      <span class="ls-label">Cover image (optional)</span>
      <div class="ls-upload-row">
        <button type="button" class="ls-attach" data-ls="pick-cover">+ Cover image</button>
        <span class="ls-hint">PNG, JPG, GIF or WebP · up to 5 MB</span>
      </div>
      <input type="file" data-ls="cover-input" accept="${IMAGE_TYPES.join(",")}" hidden>
      <div class="ls-cover-preview" data-ls="cover-preview" hidden></div>
    </div>

    <div class="input-group">
      <span class="ls-label">Attachments (optional)</span>
      <div class="ls-upload-row">
        <button type="button" class="ls-attach" data-ls="pick-files">+ Attach files</button>
        <span class="ls-hint">ZIP, PDF, DOCX, PPTX, TXT or code files · up to 10 MB each</span>
      </div>
      <input type="file" data-ls="files-input" accept="${ATTACHMENT_ACCEPT}" multiple hidden>
      <ul class="ls-file-chips" data-ls="files-preview" hidden></ul>
    </div>

    <div class="input-group">
      <span class="ls-label" id="ls-content-label">Lesson content</span>
      <div class="ls-editor-wrap"><div data-ls="editor" aria-labelledby="ls-content-label"></div></div>
      <span class="ls-hint ls-wc" data-ls="wc">0 words</span>
    </div>

    <div class="ls-quiz-builder">
      <p class="ls-cmd">$ quiz --build <span class="ls-hint">(optional)</span></p>
      <div data-ls="quiz-list"></div>
      <button type="button" class="ls-attach" data-ls="add-question">+ Add question</button>
    </div>

    <p class="ls-error" data-ls="error" role="alert" hidden></p>

    <div class="modal-actions">
      <span class="ls-progress" data-ls="progress" role="status"></span>
      <button type="button" class="ab-btn ab-btn-ghost" data-ls-dismiss>Cancel</button>
      <button type="submit" class="ab-btn ab-btn-accent" data-ls="submit">Publish lesson →</button>
    </div>
  </form>
</div>`;

let overlay;
let ui;
let quill;
let ctx = null;
let busy = false;
let cover = { file: null, existing: null };
let files = [];
let quiz = [];
let previewUrl = null;

function q(name) {
  return overlay.querySelector(`[data-ls="${name}"]`);
}

function build() {
  overlay = document.createElement("div");
  overlay.className = "modal-overlay ls-overlay";
  overlay.id = "lsEditorModal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "lsEditorTitle");
  overlay.innerHTML = TEMPLATE;
  document.body.append(overlay);

  ui = {
    heading: overlay.querySelector("#lsEditorTitle"),
    form: overlay.querySelector(".ls-form"),
    title: overlay.querySelector("#ls-f-title"),
    topic: overlay.querySelector("#ls-f-topic"),
    level: overlay.querySelector("#ls-f-level"),
    icon: overlay.querySelector("#ls-f-icon"),
    desc: overlay.querySelector("#ls-f-desc"),
    concepts: overlay.querySelector("#ls-f-concepts"),
    cmd: q("cmd"),
    coverInput: q("cover-input"),
    coverPreview: q("cover-preview"),
    filesInput: q("files-input"),
    filesPreview: q("files-preview"),
    wc: q("wc"),
    quizList: q("quiz-list"),
    error: q("error"),
    progress: q("progress"),
    submit: q("submit"),
  };

  quill = new Quill(q("editor"), {
    theme: "snow",
    formats: FORMATS,
    modules: { toolbar: TOOLBAR },
    placeholder: "Explain it like you would at a meeting. Use the </> buttons for code.",
  });
  quill.on("text-change", updateWordCount);
  labelToolbar();

  ui.topic.addEventListener("change", () => { ui.icon.placeholder = topicById(ui.topic.value)?.icon || "📘"; });
  q("pick-cover").addEventListener("click", () => ui.coverInput.click());
  q("pick-files").addEventListener("click", () => ui.filesInput.click());
  ui.coverInput.addEventListener("change", onCoverPicked);
  ui.filesInput.addEventListener("change", onFilesPicked);
  q("add-question").addEventListener("click", () => {
    if (quiz.length >= LIMITS.quiz) return showError(`A quiz can have up to ${LIMITS.quiz} questions.`);
    quiz.push({ q: "", opts: ["", "", "", ""], correct: 0, exp: "" });
    renderQuizBuilder();
    ui.quizList.querySelector(".ls-qb:last-child input")?.focus();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target.closest("[data-ls-dismiss]")) requestClose();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) requestClose();
  });
  ui.form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
}

// Screen-reader names for Quill's icon-only toolbar buttons.
function labelToolbar() {
  const names = {
    "ql-bold": "Bold", "ql-italic": "Italic", "ql-underline": "Underline", "ql-strike": "Strikethrough",
    "ql-code": "Inline code", "ql-code-block": "Code block", "ql-blockquote": "Quote",
    "ql-link": "Link", "ql-clean": "Clear formatting",
  };
  overlay.querySelectorAll(".ql-toolbar button").forEach((btn) => {
    const cls = [...btn.classList].find((c) => names[c]);
    const label = btn.classList.contains("ql-list")
      ? (btn.value === "ordered" ? "Numbered list" : "Bulleted list")
      : cls && names[cls];
    if (label) {
      btn.setAttribute("aria-label", label);
      btn.title = label;
    }
  });
}

function updateWordCount() {
  const words = wordCount(quill.getText());
  ui.wc.textContent = `${words} word${words === 1 ? "" : "s"}`;
}

function showError(message) {
  ui.error.textContent = message;
  ui.error.hidden = !message;
  if (message) ui.error.scrollIntoView({ block: "nearest" });
}

function setBusy(on, label = "") {
  busy = on;
  ui.submit.disabled = on;
  overlay.querySelectorAll("[data-ls-dismiss]").forEach((b) => { b.disabled = on; });
  ui.progress.textContent = label;
  ui.submit.textContent = on ? (ctx.mode === "edit" ? "Saving…" : "Publishing…") : (ctx.mode === "edit" ? "Save changes →" : "Publish lesson →");
}

// ─── Cover image ────────────────────────────────────────────────────

function onCoverPicked() {
  const file = ui.coverInput.files[0];
  ui.coverInput.value = "";
  if (!file) return;
  if (!IMAGE_TYPES.includes(file.type)) return showError("Cover image must be a PNG, JPG, GIF or WebP file.");
  if (file.size >= LIMITS.imageBytes) return showError(`"${cleanDisplayName(file.name)}" is over 5 MB. Choose a smaller image.`);
  showError("");
  cover.file = file;
  renderCoverPreview();
}

function renderCoverPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = cover.file ? URL.createObjectURL(cover.file) : null;
  const src = previewUrl || cover.existing?.url || null;
  if (!src) {
    ui.coverPreview.hidden = true;
    ui.coverPreview.replaceChildren();
    return;
  }
  const img = document.createElement("img");
  img.src = src;
  img.alt = "Cover preview";
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "ls-chip-x";
  removeBtn.setAttribute("aria-label", "Remove cover image");
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => {
    cover = { file: null, existing: null };
    renderCoverPreview();
  });
  ui.coverPreview.replaceChildren(img, removeBtn);
  ui.coverPreview.hidden = false;
}

// ─── Attachments ────────────────────────────────────────────────────

function onFilesPicked() {
  const picked = [...ui.filesInput.files];
  ui.filesInput.value = "";
  const problems = [];
  for (const file of picked) {
    const name = cleanDisplayName(file.name);
    if (files.length >= LIMITS.attachments) {
      problems.push(`Only ${LIMITS.attachments} attachments are allowed per lesson.`);
      break;
    }
    if (!attachmentContentType(file.name)) problems.push(`"${name}" isn't an allowed file type.`);
    else if (file.size >= LIMITS.fileBytes) problems.push(`"${name}" is over 10 MB.`);
    else files.push({ file });
  }
  showError(problems.join(" "));
  renderFileChips();
}

function renderFileChips() {
  ui.filesPreview.hidden = files.length === 0;
  ui.filesPreview.replaceChildren(...files.map((item, index) => {
    const li = document.createElement("li");
    li.className = "ls-file-chip";
    const label = document.createElement("span");
    label.textContent = cleanDisplayName(item.file ? item.file.name : item.existing.name);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "ls-chip-x";
    removeBtn.setAttribute("aria-label", `Remove ${label.textContent}`);
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      files.splice(index, 1);
      renderFileChips();
    });
    li.append(label, removeBtn);
    return li;
  }));
}

// ─── Quiz builder ───────────────────────────────────────────────────

function field(tag, props) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  return el;
}

function renderQuizBuilder() {
  ui.quizList.replaceChildren(...quiz.map((item, qi) => {
    const box = field("div", { className: "ls-qb" });
    const head = field("div", { className: "ls-qb-head" });
    head.append(field("span", { textContent: `Question ${qi + 1}` }));
    const removeBtn = field("button", { type: "button", className: "ls-mini ls-mini-danger", textContent: "Remove" });
    removeBtn.addEventListener("click", () => { quiz.splice(qi, 1); renderQuizBuilder(); });
    head.append(removeBtn);

    const question = field("input", { type: "text", className: "ls-qb-input", placeholder: "Question text…", maxLength: LIMITS.question, value: item.q });
    question.setAttribute("aria-label", `Question ${qi + 1}`);
    question.addEventListener("input", () => { item.q = question.value; });

    const opts = field("div", { className: "ls-qb-opts" });
    item.opts.forEach((opt, oi) => {
      const row = field("label", { className: "ls-qb-opt" });
      const radio = field("input", { type: "radio", name: `ls-correct-${qi}`, checked: item.correct === oi });
      radio.setAttribute("aria-label", `Option ${oi + 1} is correct`);
      radio.addEventListener("change", () => { item.correct = oi; });
      const input = field("input", { type: "text", className: "ls-qb-input", placeholder: `Option ${oi + 1}`, maxLength: LIMITS.option, value: opt });
      input.addEventListener("input", () => { item.opts[oi] = input.value; });
      row.append(radio, input);
      opts.append(row);
    });

    const exp = field("input", { type: "text", className: "ls-qb-input", placeholder: "Explanation shown after answering (optional)", maxLength: LIMITS.explanation, value: item.exp });
    exp.setAttribute("aria-label", `Explanation for question ${qi + 1}`);
    exp.addEventListener("input", () => { item.exp = exp.value; });

    const hint = field("p", { className: "ls-hint", textContent: "Pick the radio button next to the correct answer." });
    box.append(head, question, opts, hint, exp);
    return box;
  }));
}

// ─── Open / close ───────────────────────────────────────────────────

function isDirty() {
  return !!(ui.title.value.trim() || quill.getText().trim() || cover.file || files.some((f) => f.file));
}

function requestClose() {
  if (busy) return;
  if (ctx?.mode === "create" && isDirty() && !confirm("Discard this lesson?")) return;
  close();
}

function close() {
  closeOverlay(overlay);
  const done = ctx?.onClose;
  ctx = null;
  done?.();
}

function reset() {
  ui.form.reset();
  quill.setContents([], "silent");
  cover = { file: null, existing: null };
  files = [];
  quiz = [];
  renderCoverPreview();
  renderFileChips();
  renderQuizBuilder();
  showError("");
  ui.progress.textContent = "";
  ui.icon.placeholder = TOPICS[0].icon;
  updateWordCount();
}

export function openLessonEditor(options) {
  if (!overlay) build();
  if (busy) return;
  if (options.mode === "edit" && !options.lesson?.body) return;
  ctx = options;
  reset();
  if (options.mode === "edit") fillFrom(options.lesson.body);

  const editing = options.mode === "edit";
  ui.heading.replaceChildren(editing ? "Edit " : "Create ", Object.assign(document.createElement("em"), { textContent: "lesson." }));
  ui.cmd.textContent = editing ? "$ lesson --edit" : "$ lesson --new";
  setBusy(false);
  openOverlay(overlay);
  overlay.scrollTop = 0;
  ui.title.focus();
}

function fillFrom(body) {
  ui.title.value = body.title || "";
  ui.topic.value = topicById(body.topic) ? body.topic : TOPICS[0].id;
  ui.level.value = LEVELS.includes(body.level) ? body.level : LEVELS[0];
  ui.icon.value = body.icon || "";
  ui.icon.placeholder = topicById(ui.topic.value)?.icon || "📘";
  ui.desc.value = body.desc || "";
  ui.concepts.value = (Array.isArray(body.concepts) ? body.concepts : []).join("\n");
  quill.setContents(quill.clipboard.convert({ html: sanitizeLessonHtml(body.contentHtml) }), "silent");
  updateWordCount();

  cover = { file: null, existing: body.cover?.url && body.cover?.path ? { url: body.cover.url, path: body.cover.path } : null };
  renderCoverPreview();
  files = (Array.isArray(body.attachments) ? body.attachments : [])
    .filter((a) => a && a.url && a.path)
    .map((a) => ({ existing: { name: a.name, url: a.url, path: a.path, size: a.size || 0 } }));
  renderFileChips();
  quiz = (Array.isArray(body.quiz) ? body.quiz : []).filter(Boolean).map((item) => ({
    q: item.q || "",
    opts: [0, 1, 2, 3].map((i) => (Array.isArray(item.opts) && item.opts[i]) || ""),
    correct: Number.isInteger(item.correct) ? item.correct : 0,
    exp: item.exp || "",
  }));
  renderQuizBuilder();
}

// ─── Validation ─────────────────────────────────────────────────────

function collect() {
  const title = ui.title.value.trim();
  if (!title) return { error: "Give the lesson a title.", focus: ui.title };
  if (title.length > LIMITS.title) return { error: `Keep the title under ${LIMITS.title} characters.`, focus: ui.title };

  const desc = ui.desc.value.trim();
  if (desc.length > LIMITS.desc) return { error: `Keep the description under ${LIMITS.desc} characters.`, focus: ui.desc };

  const topic = topicById(ui.topic.value) ? ui.topic.value : TOPICS[0].id;
  const level = LEVELS.includes(ui.level.value) ? ui.level.value : LEVELS[0];
  const icon = (ui.icon.value.trim() || topicById(topic).icon).slice(0, LIMITS.icon);

  const concepts = ui.concepts.value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (concepts.length > LIMITS.concepts) return { error: `Use at most ${LIMITS.concepts} key concepts.`, focus: ui.concepts };
  if (concepts.some((c) => c.length > LIMITS.concept)) return { error: `Keep each key concept under ${LIMITS.concept} characters.`, focus: ui.concepts };

  const contentText = quill.getText().trim();
  if (!contentText) return { error: "Write the lesson content.", focus: quill };
  const contentHtml = sanitizeLessonHtml(deltaToLessonHtml(quill.getContents()));
  if (contentHtml.length > LIMITS.contentHtml || contentText.length > LIMITS.contentText) {
    return { error: "This lesson is too long. Split it into two lessons.", focus: quill };
  }

  const questions = [];
  for (const [i, item] of quiz.entries()) {
    const text = item.q.trim();
    const opts = item.opts.map((o) => o.trim());
    if (!text && opts.every((o) => !o)) continue; // blank question, skip it
    if (!text) return { error: `Question ${i + 1} needs question text.` };
    if (opts.filter(Boolean).length < 2) return { error: `Question ${i + 1} needs at least two options.` };
    if (!opts[item.correct]) return { error: `Question ${i + 1}: the option marked correct is empty.` };
    const entry = { q: text, opts, correct: item.correct };
    if (item.exp.trim()) entry.exp = item.exp.trim();
    questions.push(entry);
  }

  const body = { title, topic, level, icon, contentHtml, contentText };
  if (desc) body.desc = desc;
  if (concepts.length) body.concepts = concepts;
  if (questions.length) body.quiz = questions;
  return { body };
}

// ─── Upload + save ──────────────────────────────────────────────────

function uploadFile(file, path, metadata, onProgress) {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef(storage, path), file, metadata);
    task.on("state_changed",
      (snap) => onProgress(snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0),
      reject,
      () => getDownloadURL(task.snapshot.ref).then(resolve, reject));
  });
}

function friendlyError(error) {
  const code = error?.code || "";
  if (code === "storage/unauthorized") return "An upload was rejected. Check the file type and size, then try again.";
  if (code === "storage/canceled") return "Upload canceled.";
  if (code.startsWith("storage/")) return "An upload failed. Check your connection and try again.";
  if (code === "PERMISSION_DENIED" || /permission/i.test(error?.message || "")) {
    return "You don't have permission to save this lesson. Only approved members can publish, and only the author can edit.";
  }
  return "Something went wrong while saving. Nothing was published; try again.";
}

async function submit() {
  if (busy || !ctx) return;
  const result = collect();
  if (result.error) {
    showError(result.error);
    result.focus?.focus?.();
    return;
  }
  showError("");

  const { mode, user } = ctx;
  const uid = user.uid;
  const uploaded = [];
  const pending = [
    ...(cover.file ? [{ kind: "cover", file: cover.file }] : []),
    ...files.filter((f) => f.file).map((f) => ({ kind: "file", file: f.file })),
  ];
  setBusy(true, pending.length ? "Uploading…" : "");

  try {
    const body = { ...result.body };
    let step = 0;
    const progress = (fraction) => {
      ui.progress.textContent = `Uploading ${step} of ${pending.length} · ${Math.round(fraction * 100)}%`;
    };

    if (cover.file) {
      step++;
      const path = `lesson-images/${uid}/${storageFileName(cover.file.name)}`;
      const url = await uploadFile(cover.file, path, { contentType: cover.file.type }, progress);
      uploaded.push(path);
      body.cover = { url, path };
    } else if (cover.existing) {
      body.cover = cover.existing;
    }

    const attachments = [];
    for (const item of files) {
      if (item.existing) {
        attachments.push(item.existing);
        continue;
      }
      step++;
      const safeName = storageFileName(item.file.name);
      const path = `lesson-files/${uid}/${safeName}`;
      const url = await uploadFile(item.file, path, {
        contentType: attachmentContentType(item.file.name),
        contentDisposition: `attachment; filename="${safeName.replace(/^[0-9]+_/, "")}"`,
      }, progress);
      uploaded.push(path);
      attachments.push({ name: cleanDisplayName(item.file.name), url, path, size: item.file.size });
    }
    if (attachments.length) body.attachments = attachments;

    ui.progress.textContent = mode === "edit" ? "Saving…" : "Publishing…";
    body.updatedAt = serverTimestamp();

    let savedId;
    if (mode === "edit") {
      await set(dbRef(db, `lessons/${ctx.id}/body`), body);
      savedId = ctx.id;
      // Files the author removed or replaced are no longer referenced.
      const keep = new Set([body.cover?.path, ...attachments.map((a) => a.path)].filter(Boolean));
      const before = ctx.lesson?.body || {};
      const old = [before.cover?.path, ...(Array.isArray(before.attachments) ? before.attachments.map((a) => a?.path) : [])];
      await Promise.allSettled(old.filter((p) => p && !keep.has(p) && p.includes(`/${uid}/`))
        .map((p) => deleteObject(storageRef(storage, p))));
    } else {
      const lessonRef = push(dbRef(db, "lessons"));
      await set(lessonRef, {
        format: LESSON_FORMAT,
        authorId: uid,
        authorName: ctx.authorName,
        createdAt: serverTimestamp(),
        body,
      });
      savedId = lessonRef.key;
    }

    const onSaved = ctx.onSaved;
    setBusy(false);
    reset();
    close();
    onSaved?.(savedId);
  } catch (error) {
    console.error("Lesson save failed:", error);
    // Don't leave orphaned uploads from a failed attempt behind.
    await Promise.allSettled(uploaded.map((p) => deleteObject(storageRef(storage, p))));
    setBusy(false);
    showError(friendlyError(error));
  }
}
