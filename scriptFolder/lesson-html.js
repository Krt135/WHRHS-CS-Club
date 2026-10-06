// Converts the lesson editor's Quill Delta to HTML. Used instead of Quill's
// getSemanticHTML(), which (in 2.0.3) drops leading spaces inside code
// blocks and turns every space into &nbsp;. Every piece of text is escaped
// here, and the result still goes through DOMPurify before saving.

const escapeHtml = (s) => s
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const SAFE_LINK = /^(https?:|mailto:)/i;

function inline(segments) {
  return segments.map(({ text, attrs }) => {
    let html = escapeHtml(text);
    if (attrs.code) html = `<code>${html}</code>`;
    if (attrs.bold) html = `<strong>${html}</strong>`;
    if (attrs.italic) html = `<em>${html}</em>`;
    if (attrs.underline) html = `<u>${html}</u>`;
    if (attrs.strike) html = `<s>${html}</s>`;
    if (typeof attrs.link === "string" && SAFE_LINK.test(attrs.link.trim())) {
      html = `<a href="${escapeHtml(attrs.link.trim())}">${html}</a>`;
    }
    return html;
  }).join("");
}

// Split the Delta into lines: inline segments plus the line's block format.
function toLines(delta) {
  const lines = [];
  let segments = [];
  for (const op of delta.ops || []) {
    if (typeof op.insert !== "string") continue; // no embeds in lessons
    const attrs = op.attributes || {};
    const parts = op.insert.split("\n");
    parts.forEach((part, i) => {
      if (part) segments.push({ text: part, attrs });
      if (i < parts.length - 1) {
        lines.push({ segments, block: attrs });
        segments = [];
      }
    });
  }
  if (segments.length) lines.push({ segments, block: {} });
  return lines;
}

export function deltaToLessonHtml(delta) {
  const lines = toLines(delta);
  const out = [];
  let i = 0;

  // Consecutive lines that share a block format become one element.
  const takeWhile = (test) => {
    const group = [];
    while (i < lines.length && test(lines[i].block)) group.push(lines[i++]);
    return group;
  };

  while (i < lines.length) {
    const block = lines[i].block;
    if (block["code-block"]) {
      const group = takeWhile((b) => b["code-block"]);
      const code = group.map((l) => escapeHtml(l.segments.map((s) => s.text).join(""))).join("\n");
      out.push(`<pre><code>${code}</code></pre>`);
    } else if (block.list === "bullet" || block.list === "ordered") {
      const kind = block.list;
      const tag = kind === "ordered" ? "ol" : "ul";
      const group = takeWhile((b) => b.list === kind);
      out.push(`<${tag}>${group.map((l) => `<li>${inline(l.segments) || "<br>"}</li>`).join("")}</${tag}>`);
    } else if (block.blockquote) {
      const group = takeWhile((b) => b.blockquote);
      out.push(`<blockquote>${group.map((l) => inline(l.segments)).join("<br>")}</blockquote>`);
    } else if (block.header === 2 || block.header === 3) {
      i++;
      out.push(`<h${block.header}>${inline(lines[i - 1].segments)}</h${block.header}>`);
    } else {
      i++;
      out.push(`<p>${inline(lines[i - 1].segments) || "<br>"}</p>`);
    }
  }
  return out.join("");
}
