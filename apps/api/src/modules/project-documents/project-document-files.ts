const supportedMimeTypesByExtension: Record<string, ReadonlySet<string>> = {
  css: new Set(["text/css", "text/plain"]),
  csv: new Set(["text/csv", "text/plain"]),
  html: new Set(["text/html", "text/plain"]),
  js: new Set(["application/javascript", "text/javascript", "text/plain"]),
  json: new Set(["application/json", "text/plain"]),
  log: new Set(["text/plain"]),
  md: new Set(["text/markdown", "text/plain"]),
  ts: new Set(["application/typescript", "text/plain", "text/typescript", "video/mp2t"]),
  txt: new Set(["text/plain"]),
};

export const PROJECT_DOCUMENT_IMPORT_POLICY = Object.freeze({
  maxFiles: 4,
  maxFileBytes: 1_000_000,
  maxNameChars: 255,
  supportedExtensions: Object.keys(supportedMimeTypesByExtension),
  supportedTypesLabel:
    "TXT, Markdown, LOG, CSV, JSON, HTML, CSS, JavaScript, or TypeScript",
});

const supportedExtensions = new Set<string>(PROJECT_DOCUMENT_IMPORT_POLICY.supportedExtensions);

export function isSupportedProjectDocumentFile(name: string, mimeType: string) {
  const extension = getFileExtension(name);

  if (!supportedExtensions.has(extension)) return false;

  const supportedMimeTypes = supportedMimeTypesByExtension[extension];

  return Boolean(supportedMimeTypes && (!mimeType || supportedMimeTypes.has(mimeType)));
}

function getFileExtension(fileName: string) {
  const parts = fileName.toLowerCase().split(".");

  return parts.length > 1 ? parts.at(-1) || "" : "";
}
