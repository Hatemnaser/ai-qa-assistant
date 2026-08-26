import type { ProjectDocument } from "./types";
import { getAssetDownloadUrl } from "../assets/assetsApi";

export interface ProjectDocumentDownload {
  content: string;
  fileName: string;
  mimeType: string;
}

export function getProjectDocumentDownload(document: ProjectDocument): ProjectDocumentDownload {
  const isCreatedDocument = document.source === "USER_PROVIDED";
  const sourceName = isCreatedDocument ? document.title : document.metadata?.originalName || document.title;
  const safeName = sanitizeFileName(sourceName);

  return {
    content: document.content,
    fileName: isCreatedDocument && !safeName.toLowerCase().endsWith(".md") ? `${safeName}.md` : safeName,
    mimeType: isCreatedDocument ? "text/markdown" : document.mimeType || "text/plain",
  };
}

export async function downloadProjectDocument(document: ProjectDocument) {
  if (document.sourceAssetId) {
    const url = await getAssetDownloadUrl(document.sourceAssetId);
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const download = getProjectDocumentDownload(document);
  const blobType = download.mimeType.toLowerCase().includes("charset=")
    ? download.mimeType
    : `${download.mimeType};charset=utf-8`;
  const blob = new Blob([download.content], {
    type: blobType,
  });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");

  link.href = url;
  link.download = download.fileName;

  window.document.body.appendChild(link);
  link.click();
  window.document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

function sanitizeFileName(fileName: string) {
  return (
    fileName
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .trim()
      .replace(/[. ]+$/g, "") || "project-document"
  );
}
