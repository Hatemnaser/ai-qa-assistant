import { createHash } from "node:crypto";

import {
  chunkProjectDocument,
  normalizeStructuredContent,
  type ProjectDocumentChunk,
} from "./project-document-chunks.js";
import type { ProjectDocumentRecord } from "./project-documents.repository.js";

export const PROJECT_DOCUMENT_CHUNKING_VERSION = "boundary-v1";

export interface PreparedProjectDocumentChunk extends ProjectDocumentChunk {
  contentHash: string;
}

export interface PreparedProjectDocumentIndex {
  chunks: PreparedProjectDocumentChunk[];
  chunkingVersion: string;
  contentHash: string;
  documentId: string;
  sourceUpdatedAt: Date;
}

export function needsProjectDocumentIndex(document: ProjectDocumentRecord) {
  if (document.indexStatus === "FAILED") return false;

  return (
    document.indexStatus === "PENDING" ||
    !document.contentHash ||
    document.chunkingVersion !== PROJECT_DOCUMENT_CHUNKING_VERSION
  );
}

export function prepareProjectDocumentIndex(
  document: ProjectDocumentRecord
): PreparedProjectDocumentIndex {
  const title = document.title.replace(/\s+/g, " ").trim();
  const content = normalizeStructuredContent(document.content);
  const contentHash = hashValue(
    JSON.stringify({
      chunkingVersion: PROJECT_DOCUMENT_CHUNKING_VERSION,
      content,
      title,
    })
  );

  return {
    chunks: chunkProjectDocument(document).map((chunk) => ({
      ...chunk,
      contentHash: hashValue(
        JSON.stringify({
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          documentHash: contentHash,
        })
      ),
    })),
    chunkingVersion: PROJECT_DOCUMENT_CHUNKING_VERSION,
    contentHash,
    documentId: document.id,
    sourceUpdatedAt: document.updatedAt,
  };
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
