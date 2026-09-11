import { createHash } from "node:crypto";

import { prisma } from "../../db/prisma.js";
import {
  projectDocumentRetriever,
} from "../project-documents/project-document-hybrid-retrieval.js";
import type { ProjectDocumentRetriever } from "../project-documents/project-document-retrieval.js";
import type { ProjectQaContextBuilder } from "./qa-requests.types.js";

export interface ProjectQaContextBuilderDependencies {
  database?: Pick<typeof prisma, "project">;
  documentRetriever?: ProjectDocumentRetriever;
}

export function createProjectQaContextBuilder(
  {
    database = prisma,
    documentRetriever = projectDocumentRetriever,
  }: ProjectQaContextBuilderDependencies = {}
): ProjectQaContextBuilder {
  return {
    async build(input) {
      const project = await database.project.findUnique({
        select: {
          id: true,
          name: true,
          instruction: { select: { content: true, updatedAt: true } },
          projectMemory: { select: { content: true, updatedAt: true } },
          documents: {
            orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
            select: {
              chunkingVersion: true,
              content: true,
              contentHash: true,
              createdAt: true,
              id: true,
              indexError: true,
              indexStatus: true,
              indexedAt: true,
              metadata: true,
              mimeType: true,
              projectId: true,
              source: true,
              sourceAssetId: true,
              title: true,
              updatedAt: true,
            },
          },
        },
        where: { id: input.projectId },
      });

      if (!project) {
        return emptySnapshot(input);
      }

      const retrievalQuery = [
        input.title,
        input.objective,
        input.target || "",
        input.acceptanceNotes || "",
      ].join(" ");
      const retrievedChunks = await documentRetriever.retrieve({
        documents: project.documents,
        projectId: project.id,
        query: retrievalQuery,
        userId: input.userId,
      });
      const documentUpdatedAt = new Map(
        project.documents.map((document) => [document.id, document.updatedAt.toISOString()])
      );
      const selectedChunks = retrievedChunks.map((chunk) => ({
        chunkId: `${chunk.documentId}:${chunk.chunkIndex}:${sha256(chunk.content).slice(0, 16)}`,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        contentHash: sha256(chunk.content),
        documentId: chunk.documentId,
        documentTitle: chunk.title,
        documentUpdatedAt: documentUpdatedAt.get(chunk.documentId) || null,
        source: "SHARED_PROJECT_RETRIEVER" as const,
      }));
      const payload = {
        request: {
          acceptanceNotes: input.acceptanceNotes || null,
          environment: input.environment || null,
          objective: input.objective,
          target: input.target || null,
          title: input.title,
        },
        project: {
          id: project.id,
          name: project.name,
          instructions: project.instruction?.content || null,
          memory: project.projectMemory?.content || null,
        },
        documentChunks: selectedChunks,
      };
      const sourceManifest = {
        instructions: project.instruction
          ? { present: true, updatedAt: project.instruction.updatedAt.toISOString() }
          : { present: false },
        memory: project.projectMemory
          ? { present: true, updatedAt: project.projectMemory.updatedAt.toISOString() }
          : { present: false },
        documents: project.documents.map((document) => ({
          id: document.id,
          title: document.title,
          contentHash: document.contentHash || sha256(document.content),
          indexStatus: document.indexStatus,
          updatedAt: document.updatedAt.toISOString(),
        })),
      };

      return {
        degraded: project.documents.length > 0 && selectedChunks.length === 0,
        payload,
        payloadHash: sha256(JSON.stringify(payload)),
        retrievalMode: selectedChunks.length === 0
          ? "NONE"
          : "SHARED_PROJECT_RETRIEVER",
        sourceManifest,
      };
    },
  };
}

export const projectQaContextBuilder = createProjectQaContextBuilder();

function emptySnapshot(input: {
  title: string;
  objective: string;
  target?: string;
  environment?: string;
  acceptanceNotes?: string;
}) {
  const payload = {
    request: {
      acceptanceNotes: input.acceptanceNotes || null,
      environment: input.environment || null,
      objective: input.objective,
      target: input.target || null,
      title: input.title,
    },
    project: null,
    documentChunks: [],
  };
  return {
    degraded: true,
    payload,
    payloadHash: sha256(JSON.stringify(payload)),
    retrievalMode: "NONE",
    sourceManifest: { instructions: { present: false }, memory: { present: false }, documents: [] },
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
