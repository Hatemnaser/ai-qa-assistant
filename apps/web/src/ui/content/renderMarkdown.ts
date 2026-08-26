import DOMPurify from "dompurify";
import { marked } from "marked";

/** Shared sanitized Markdown renderer for chat and document surfaces. */
export function renderMarkdown(content: string) {
  const html = marked.parse(content, {
    async: false,
  }) as string;

  return DOMPurify.sanitize(html);
}
