import highlightJs from "highlight.js/lib/core";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

import type { ProjectDocument } from "./types";
import { getProjectDocumentType } from "./projectDocumentTypes";

export const PROJECT_DOCUMENT_RICH_PREVIEW_LIMIT = 200_000;

highlightJs.registerLanguage("css", css);
highlightJs.registerLanguage("javascript", javascript);
highlightJs.registerLanguage("json", json);
highlightJs.registerLanguage("typescript", typescript);
highlightJs.registerLanguage("xml", xml);

export function getProjectDocumentHighlightedHtml(document: ProjectDocument) {
  const documentType = getProjectDocumentType(document);

  if (
    documentType.previewKind !== "code" ||
    !documentType.highlightLanguage ||
    !canUseRichProjectDocumentPreview(document)
  ) {
    return "";
  }

  return highlightJs.highlight(document.content, {
    language: documentType.highlightLanguage,
  }).value;
}

export function getProjectDocumentLineNumbers(content: string) {
  if (content.length > PROJECT_DOCUMENT_RICH_PREVIEW_LIMIT) return "";

  const lineCount = Math.max(1, content.split(/\r?\n/).length);

  return Array.from({ length: lineCount }, (_, index) => index + 1).join("\n");
}

export function canUseRichProjectDocumentPreview(document: ProjectDocument) {
  return document.content.length <= PROJECT_DOCUMENT_RICH_PREVIEW_LIMIT;
}
