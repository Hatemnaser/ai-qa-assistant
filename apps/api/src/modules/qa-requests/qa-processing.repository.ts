import { prisma } from "../../db/prisma.js";
import type { QaProcessingOperationDto, QaProcessingRepository } from "./qa-processing.types.js";

export function createQaProcessingRepository(database: typeof prisma = prisma): QaProcessingRepository {
  return {
    async claimNext(input) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const candidate = await database.qaGenerationExecution.findFirst({
          orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
          select: { id: true },
          where: {
            kind: { in: input.kinds },
            OR: [
              { availableAt: { lte: input.now }, status: "PENDING" },
              { leaseExpiresAt: { lte: input.now }, status: "PROCESSING" },
            ],
          },
        });
        if (!candidate) return null;

        const claimed = await database.qaGenerationExecution.updateMany({
          data: {
            attempts: { increment: 1 },
            errorCode: null,
            leaseExpiresAt: input.leaseExpiresAt,
            leaseToken: input.leaseToken,
            status: "PROCESSING",
          },
          where: {
            id: candidate.id,
            kind: { in: input.kinds },
            OR: [
              { availableAt: { lte: input.now }, status: "PENDING" },
              { leaseExpiresAt: { lte: input.now }, status: "PROCESSING" },
            ],
          },
        });
        if (claimed.count !== 1) continue;

        const job = await database.qaGenerationExecution.findUnique({
          where: { id: candidate.id },
        });
        if (!job || !job.leaseExpiresAt || job.leaseToken !== input.leaseToken) continue;
        return {
          artifactId: job.artifactId,
          attempts: job.attempts,
          id: job.id,
          kind: job.kind,
          leaseExpiresAt: job.leaseExpiresAt,
          leaseToken: input.leaseToken,
          profileManifest: job.profileManifest,
          profileManifestHash: job.profileManifestHash,
          recipeId: job.recipeId,
          requestId: job.requestId,
        };
      }
      return null;
    },

    async countQueue(now) {
      const [pending, processing, stale] = await Promise.all([
        database.qaGenerationExecution.count({ where: { status: "PENDING" } }),
        database.qaGenerationExecution.count({ where: { status: "PROCESSING" } }),
        database.qaGenerationExecution.count({
          where: { leaseExpiresAt: { lte: now }, status: "PROCESSING" },
        }),
      ]);
      return { pending, processing, stale };
    },

    async getOperation(projectId, operationId) {
      const operation = await database.qaGenerationExecution.findFirst({
        where: { id: operationId, request: { projectId } },
      });
      return operation ? toDto(operation) : null;
    },

    async getRequestOperation(input) {
      const operation = await database.qaGenerationExecution.findFirst({
        orderBy: { createdAt: "desc" },
        where: {
          artifactId: input.artifactId ?? null,
          kind: input.kind,
          recipeId: input.recipeId,
          requestId: input.requestId,
        },
      });
      return operation ? toDto(operation) : null;
    },

    async markTerminal(input) {
      const updated = await database.qaGenerationExecution.updateMany({
        data: {
          completedAt: new Date(),
          errorCode: input.errorCode,
          leaseExpiresAt: null,
          leaseToken: null,
          status: "FAILED",
        },
        where: { id: input.id, leaseToken: input.leaseToken, status: "PROCESSING" },
      });
      return updated.count === 1;
    },

    async scheduleRetry(input) {
      const updated = await database.qaGenerationExecution.updateMany({
        data: {
          availableAt: input.availableAt,
          errorCode: input.errorCode,
          leaseExpiresAt: null,
          leaseToken: null,
          status: "PENDING",
        },
        where: {
          id: input.id,
          leaseToken: input.leaseToken,
          status: "PROCESSING",
        },
      });
      return updated.count === 1;
    },
  };
}

export const qaProcessingRepository = createQaProcessingRepository();

function toDto(operation: {
  artifactId: string | null;
  attempts: number;
  availableAt: Date;
  completedAt: Date | null;
  errorCode: string | null;
  id: string;
  kind: QaProcessingOperationDto["kind"];
  recipeId: string | null;
  requestId: string;
  status: QaProcessingOperationDto["status"];
}): QaProcessingOperationDto {
  return {
    artifactId: operation.artifactId,
    attempts: operation.attempts,
    availableAt: operation.status === "PENDING" ? operation.availableAt.toISOString() : null,
    completedAt: operation.completedAt?.toISOString() || null,
    errorCode: operation.errorCode,
    kind: operation.kind,
    operationId: operation.id,
    recipeId: operation.recipeId,
    requestId: operation.requestId,
    status: operation.status,
  };
}
