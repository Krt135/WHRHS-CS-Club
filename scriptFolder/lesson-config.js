// Shared constants for member-written lessons (Resources page).
// Database layout (Realtime Database), see database.rules.json "lessons":
//   lessons/{id}
//     format: "rich-v1"            marks the new lesson format
//     authorId, authorName, createdAt
//     body/                         the only part the author can edit
//       title, topic, level, icon, desc, concepts[], contentHtml,
//       contentText, quiz[{q, opts[4], correct, exp}],
//       cover {url, path}, attachments[{name, url, path, size}], updatedAt
//     userLikes/{uid}: true         one reaction per user; counts are
//     userDislikes/{uid}: true      derived from these maps, never stored
//     comments/{id}  {authorId, authorName, text, createdAt, userLikes/{uid}}
// Older lectures/links/text lessons stay in resources/ and render as before.

export const LESSON_FORMAT = "rich-v1";

export const TOPICS = [
  { id: "gamedev", label: "Game Dev", icon: "🎮" },
  { id: "webdev", label: "Web Dev", icon: "🌐" },
  { id: "cp", label: "Competitive Programming", icon: "🏆" },
  { id: "python", label: "Python", icon: "🐍" },
  { id: "javascript", label: "JavaScript", icon: "⚡" },
  { id: "unity", label: "Unity", icon: "🧊" },
  { id: "career", label: "General/Career", icon: "💼" },
];

export const LEVELS = ["Beginner", "Intermediate", "Advanced"];

// Keep in sync with database.rules.json and storage.rules.
export const LIMITS = {
  title: 120,
  desc: 200,
  icon: 16,
  concept: 120,
  concepts: 20,
  contentHtml: 100000,
  contentText: 50000,
  comment: 1000,
  quiz: 20,
  question: 300,
  option: 200,
  explanation: 500,
  attachments: 10,
  attachmentName: 120,
  imageBytes: 5 * 1024 * 1024,
  fileBytes: 10 * 1024 * 1024,
};

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// Extension -> stored content type. Code/text is stored as text/plain so the
// browser never renders it; html, svg and js/ts are deliberately absent.
const OFFICE = "application/vnd.openxmlformats-officedocument";
export const FILE_TYPES = {
  zip: "application/zip",
  pdf: "application/pdf",
  docx: `${OFFICE}.wordprocessingml.document`,
  pptx: `${OFFICE}.presentationml.presentation`,
};
export const TEXT_EXTENSIONS = [
  "txt", "md", "csv", "json", "py", "java", "c", "cpp", "h", "hpp",
  "cs", "go", "rs", "rb", "kt", "swift", "ipynb",
];

export const ATTACHMENT_ACCEPT = [...Object.keys(FILE_TYPES), ...TEXT_EXTENSIONS]
  .map((ext) => `.${ext}`).join(",");

export function topicById(id) {
  return TOPICS.find((t) => t.id === id) || null;
}

export function fileExtension(name) {
  const match = /\.([A-Za-z0-9]+)$/.exec(name || "");
  return match ? match[1].toLowerCase() : "";
}

// Content type to store for an attachment, or null if it isn't allowed.
export function attachmentContentType(name) {
  const ext = fileExtension(name);
  if (FILE_TYPES[ext]) return FILE_TYPES[ext];
  if (TEXT_EXTENSIONS.includes(ext)) return "text/plain";
  return null;
}

// "<timestamp>_<safe name>", matching the storage.rules filename pattern.
export function storageFileName(name) {
  const ext = fileExtension(name);
  const base = (name || "file").replace(/\.[^.]*$/, "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "file";
  return `${Date.now()}_${base}${ext ? `.${ext}` : ""}`;
}

// Display name for an attachment chip (the stored name is shown as text only).
export function cleanDisplayName(name) {
  return String(name || "file").replace(/[\u0000-\u001f]/g, "").slice(0, LIMITS.attachmentName);
}

export function isMemberProfile(profile) {
  return !!profile && (profile.status === "approved" || profile.role === "exec" || profile.role === "admin");
}

export function wordCount(text) {
  const trimmed = (text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
