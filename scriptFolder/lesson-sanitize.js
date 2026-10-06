// Lesson HTML is written by members, so it is run through DOMPurify both
// before saving and before rendering. The allowlist covers only what the
// lesson editor can produce.
import DOMPurify from "dompurify";

const purifier = DOMPurify();

const CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "h2", "h3", "strong", "em", "u", "s",
    "code", "pre", "blockquote", "ol", "ul", "li", "a",
  ],
  ALLOWED_ATTR: ["href", "target", "rel"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  ALLOW_DATA_ATTR: false,
};

// Every surviving link opens in a new tab without access to this page.
purifier.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    if (!node.getAttribute("href")) {
      node.removeAttribute("target");
      node.removeAttribute("rel");
      return;
    }
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  }
});

export function sanitizeLessonHtml(html) {
  return purifier.sanitize(String(html || ""), CONFIG);
}
