import type { ProjectDocument } from "./types";

export type ProjectDocumentPreviewKind = "code" | "markdown" | "text";

export interface ProjectDocumentTypeDefinition {
  extension: string;
  highlightLanguage?: string;
  label: string;
  mimeType: string;
  previewKind: ProjectDocumentPreviewKind;
}

const PROJECT_DOCUMENT_TYPES = {
  css: {
    extension: "css",
    highlightLanguage: "css",
    label: "CSS",
    mimeType: "text/css",
    previewKind: "code",
  },
  csv: {
    extension: "csv",
    label: "CSV",
    mimeType: "text/csv",
    previewKind: "text",
  },
  html: {
    extension: "html",
    highlightLanguage: "xml",
    label: "HTML",
    mimeType: "text/html",
    previewKind: "code",
  },
  js: {
    extension: "js",
    highlightLanguage: "javascript",
    label: "JS",
    mimeType: "text/javascript",
    previewKind: "code",
  },
  json: {
    extension: "json",
    highlightLanguage: "json",
    label: "JSON",
    mimeType: "application/json",
    previewKind: "code",
  },
  log: {
    extension: "log",
    label: "LOG",
    mimeType: "text/plain",
    previewKind: "text",
  },
  md: {
    extension: "md",
    label: "MD",
    mimeType: "text/markdown",
    previewKind: "markdown",
  },
  ts: {
    extension: "ts",
    highlightLanguage: "typescript",
    label: "TS",
    mimeType: "text/typescript",
    previewKind: "code",
  },
  txt: {
    extension: "txt",
    label: "TXT",
    mimeType: "text/plain",
    previewKind: "text",
  },
} as const satisfies Record<string, ProjectDocumentTypeDefinition>;

const fallbackDocumentType: ProjectDocumentTypeDefinition = {
  extension: "txt",
  label: "TEXT",
  mimeType: "text/plain",
  previewKind: "text",
};

export const PROJECT_DOCUMENT_SUPPORTED_EXTENSIONS = Object.freeze(Object.keys(PROJECT_DOCUMENT_TYPES));

export function getProjectDocumentType(document: ProjectDocument): ProjectDocumentTypeDefinition {
  if (document.source === "USER_PROVIDED") {
    return PROJECT_DOCUMENT_TYPES.md;
  }

  return getProjectDocumentTypeByFileName(document.metadata?.originalName || document.title);
}

export function getProjectDocumentTypeByFileName(fileName: string): ProjectDocumentTypeDefinition {
  const extension = getProjectDocumentFileExtension(fileName);

  return PROJECT_DOCUMENT_TYPES[extension as keyof typeof PROJECT_DOCUMENT_TYPES] || fallbackDocumentType;
}

export function getProjectDocumentFileExtension(fileName: string) {
  const parts = fileName.toLowerCase().split(".");

  return parts.length > 1 ? parts.at(-1) || "" : "";
}
