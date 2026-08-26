import { DATA_LIMITS } from "../../config/data-limits.js";
import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { enqueueAssetDeletionJobs } from "../assets/assets.deletion-outbox.js";
import type {
  CreateProjectDocumentInput,
  ProjectDocumentMetadata,
  ProjectDocumentRecord,
  ProjectDocumentsRepository,
} from "./project-documents.types.js";

export function createPrismaProjectDocumentsRepository(
  database: typeof prisma = prisma
): ProjectDocumentsRepository {
  return {
    async createProjectDocument(input) {
      return database.$transaction(async (tx) => {
        await assertProjectDocumentQuota(tx, [input]);

        return tx.projectDocument.create({
          data: {
            content: input.content,
            metadata: toJsonMetadata(input.metadata),
            mimeType: input.mimeType || null,
            projectId: input.projectId,
            source: input.source || "USER_PROVIDED",
            sourceAssetId: input.sourceAssetId || null,
            title: input.title,
          },
        });
      });
    },

    async createProjectDocuments(inputs) {
      return database.$transaction(async (tx) => {
        await assertProjectDocumentQuota(tx, inputs);

        const storedInputs = inputs.filter(
          (input): input is CreateProjectDocumentInput & {
            sourceAssetId: string;
            sourceAssetOwnerId: string;
          } => Boolean(input.sourceAssetId && input.sourceAssetOwnerId)
        );
        const sourceAssetIds = storedInputs.map((input) => input.sourceAssetId);

        for (const assetId of [...new Set(sourceAssetIds)].sort()) {
          await lockAsset(tx, assetId);
        }

        if (sourceAssetIds.length > 0) {
          const assets = await tx.storedAsset.findMany({
            select: {
              id: true,
              ownerId: true,
              projectId: true,
              purpose: true,
              sourceDocument: { select: { id: true } },
              status: true,
            },
            where: { id: { in: sourceAssetIds } },
          });
          const assetById = new Map(assets.map((asset) => [asset.id, asset]));

          for (const input of storedInputs) {
            const asset = assetById.get(input.sourceAssetId);
            if (
              !asset ||
              asset.ownerId !== input.sourceAssetOwnerId ||
              asset.projectId !== input.projectId ||
              asset.purpose !== "PROJECT_DOCUMENT_SOURCE" ||
              asset.status !== "READY"
            ) {
              throw new AppError("Asset was not found.", 404, "ASSET_NOT_FOUND");
            }
            if (asset.sourceDocument) {
              throw new AppError(
                "Stored document source is already linked.",
                409,
                "ASSET_ALREADY_ATTACHED"
              );
            }
          }
        }

        const documents: ProjectDocumentRecord[] = [];
        for (const input of inputs) {
          documents.push(await tx.projectDocument.create({
            data: {
              content: input.content,
              metadata: toJsonMetadata(input.metadata),
              mimeType: input.mimeType || null,
              projectId: input.projectId,
              source: input.source || "USER_PROVIDED",
              sourceAssetId: input.sourceAssetId || null,
              title: input.title,
            },
          }));
        }

        return documents;
      });
    },

    async deleteProjectDocument(projectId, documentId) {
      return database.$transaction(async (tx) => {
        const document = await tx.projectDocument.findFirst({
          select: {
            sourceAsset: {
              select: { objectKey: true, uploadExpiresAt: true },
            },
          },
          where: {
            id: documentId,
            projectId,
          },
        });

        if (!document) return 0;

        const objectKey = document.sourceAsset?.objectKey;

        if (objectKey) {
          await enqueueAssetDeletionJobs(tx, [{
            objectKey,
            uploadExpiresAt: document.sourceAsset?.uploadExpiresAt,
          }]);
          await tx.storedAsset.updateMany({
            data: { status: "DELETE_PENDING" },
            where: { objectKey },
          });
        }

        const result = await tx.projectDocument.deleteMany({
          where: {
            id: documentId,
            projectId,
          },
        });

        return result.count;
      });
    },

    async findProjectDocument(projectId, documentId) {
      return database.projectDocument.findFirst({
        where: {
          id: documentId,
          projectId,
        },
      });
    },

    async listProjectDocuments(projectId) {
      return database.projectDocument.findMany({
        orderBy: {
          updatedAt: "desc",
        },
        take: DATA_LIMITS.documentsPerProject,
        where: {
          projectId,
        },
      });
    },

    async updateProjectDocument(input) {
      const result = await database.projectDocument.updateMany({
        data: {
          chunkingVersion: "",
          content: input.content,
          contentHash: "",
          indexError: null,
          indexedAt: null,
          indexStatus: "PENDING",
          mimeType: input.mimeType || null,
          title: input.title,
        },
        where: {
          id: input.documentId,
          projectId: input.projectId,
        },
      });

      if (result.count === 0) return null;

      return database.projectDocument.findFirst({
        where: {
          id: input.documentId,
          projectId: input.projectId,
        },
      });
    },
  };
}

function toJsonMetadata(metadata: ProjectDocumentMetadata | null | undefined) {
  if (!metadata) return undefined;

  return {
    ...(metadata.originalName ? { originalName: metadata.originalName } : {}),
    ...(metadata.sizeBytes !== undefined ? { sizeBytes: metadata.sizeBytes } : {}),
  };
}

export const projectDocumentsRepository = createPrismaProjectDocumentsRepository();

async function lockAsset(tx: Prisma.TransactionClient, assetId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:asset:${assetId}`}, 0))`;
}

async function assertProjectDocumentQuota(
  tx: Prisma.TransactionClient,
  inputs: CreateProjectDocumentInput[]
) {
  const additionsByProject = new Map<string, number>();

  for (const input of inputs) {
    additionsByProject.set(
      input.projectId,
      (additionsByProject.get(input.projectId) || 0) + 1
    );
  }

  for (const [projectId, additions] of [...additionsByProject.entries()].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:quota:documents:${projectId}`}, 0))`;
    const documentCount = await tx.projectDocument.count({ where: { projectId } });

    if (documentCount + additions > DATA_LIMITS.documentsPerProject) {
      throw new AppError(
        `A project can contain up to ${DATA_LIMITS.documentsPerProject} documents. Delete one before adding another.`,
        409,
        "PROJECT_DOCUMENT_LIMIT_REACHED"
      );
    }
  }
}
