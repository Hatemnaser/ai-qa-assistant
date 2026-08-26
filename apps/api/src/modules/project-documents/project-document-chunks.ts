import type { ProjectDocumentRecord } from "./project-documents.types.js";

export const PROJECT_DOCUMENT_CHUNKING_POLICY = Object.freeze({
  chunkOverlapChars: 120,
  maxChunkChars: 1200,
  minBoundaryChars: 650,
});

export interface ProjectDocumentChunk {
  chunkCount: number;
  chunkIndex: number;
  content: string;
  documentId: string;
  title: string;
}

interface ChunkTextOptions {
  maxChars?: number;
  minBoundaryChars?: number;
  overlapChars?: number;
}

export function chunkProjectDocument(document: ProjectDocumentRecord): ProjectDocumentChunk[] {
  const title = document.title.replace(/\s+/g, " ").trim();

  if (!title) return [];

  const contents = chunkStructuredText(document.content);

  return contents.map((content, chunkIndex) => ({
    chunkCount: contents.length,
    chunkIndex,
    content,
    documentId: document.id,
    title,
  }));
}

export function chunkStructuredText(
  content: string,
  options: ChunkTextOptions = {}
): string[] {
  const maxChars = options.maxChars ?? PROJECT_DOCUMENT_CHUNKING_POLICY.maxChunkChars;

  if (maxChars < 1) return [];

  const overlapChars = Math.min(
    Math.max(0, options.overlapChars ?? PROJECT_DOCUMENT_CHUNKING_POLICY.chunkOverlapChars),
    Math.floor(maxChars / 2)
  );
  const minBoundaryChars = Math.min(
    Math.max(1, options.minBoundaryChars ?? PROJECT_DOCUMENT_CHUNKING_POLICY.minBoundaryChars),
    maxChars
  );

  const normalized = normalizeStructuredContent(content);

  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const hardEnd = Math.min(start + maxChars, normalized.length);
    const end =
      hardEnd === normalized.length
        ? hardEnd
        : findPreferredChunkEnd(normalized, start, hardEnd, minBoundaryChars);
    const chunk = normalized.slice(start, end).trim();

    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;

    const overlapStart = Math.max(start + 1, end - Math.max(0, overlapChars));
    start = findPreferredOverlapStart(normalized, start, overlapStart);
  }

  return chunks;
}

export function normalizeStructuredContent(content: string) {
  return content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findPreferredChunkEnd(
  content: string,
  start: number,
  hardEnd: number,
  minBoundaryChars: number
) {
  const minimumEnd = Math.min(start + minBoundaryChars, hardEnd);

  for (const separator of ["\n\n", "\n", " "]) {
    const boundary = content.lastIndexOf(separator, hardEnd - 1);

    if (boundary >= minimumEnd) {
      return boundary + separator.length;
    }
  }

  return hardEnd;
}

function findPreferredOverlapStart(content: string, previousStart: number, targetStart: number) {
  const searchFloor = Math.max(previousStart + 1, targetStart - 80);

  for (const separator of ["\n\n", "\n", " "]) {
    const boundary = content.lastIndexOf(separator, targetStart);

    if (boundary >= searchFloor) {
      return boundary + separator.length;
    }
  }

  return targetStart;
}
