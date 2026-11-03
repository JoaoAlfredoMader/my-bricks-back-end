import sanitizeHtml from "sanitize-html";

/**
 * The only markup a template may carry: what the PDF renderer understands. Everything else is
 * dropped (its text is kept), attributes included, and `<script>` / `<style>` lose their content.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "h1", "h2", "h3", "ul", "ol", "li", "br", "strong", "b", "em", "i", "u"],
  allowedAttributes: {},
  // A browser editor often wraps lines in <div>; a paragraph is the closest thing.
  transformTags: { div: "p" },
  disallowedTagsMode: "discard",
};

export function sanitizeTemplateHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}
