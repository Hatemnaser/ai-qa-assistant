import { prisma } from "../../db/prisma.js";
import { AppError } from "../../lib/errors.js";
import { Prisma } from "../../generated/prisma/client.js";
import { ASSET_UPLOAD_REPLAY_GRACE_MS } from "./assets.deletion.js";
import { enqueueAssetDeletionJobs } from "./assets.deletion-outbox.js";
import type { AssetsRepository } from "./assets.types.js";

export function createPrismaAssetsRepository(database: typeof prisma = prisma): AssetsRepository {
  return {
    async cancelPendingAsset(ownerId, assetId, now) {
      return enqueueAssetDeletionForStatuses(database, ownerId, assetId, ["PENDING"], now);
    },

    async claimPendingAssetForValidation(ownerId, assetId, now) {
      const claimed = await database.storedAsset.updateMany({
        data: { status: "VALIDATING", validationStartedAt: now },
        where: {
          id: assetId,
          ownerId,
          status: "PENDING",
          uploadExpiresAt: { gt: now },
        },
      });
      if (claimed.count !== 1) return null;

      return database.storedAsset.findFirst({ where: { id: assetId, ownerId, status: "VALIDATING" } });
    },

    async completeValidatingAsset(input) {
      const updated = await database.storedAsset.updateMany({
        data: {
          detectedMimeType: input.detectedMimeType,
          etag: input.etag,
          readyAt: input.readyAt,
          sizeBytes: input.sizeBytes,
          status: "READY",
          validationStartedAt: null,
        },
        where: {
          id: input.assetId,
          ownerId: input.ownerId,
          status: "VALIDATING",
        },
      });

      if (updated.count !== 1) return null;

      return database.storedAsset.findFirst({ where: { id: input.assetId, ownerId: input.ownerId } });
    },

    async createPendingAssetReservation(input) {
      return withSerializableRetry(async () => database.$transaction(async (tx) => {
        // Serialize reservations for this user without exposing their ID in the object key.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.ownerId}, 0))`;
        const [pendingCount, reserved] = await Promise.all([
          tx.storedAsset.count({ where: { ownerId: input.ownerId, status: { in: ["PENDING", "VALIDATING"] } } }),
          tx.storedAsset.aggregate({
            _sum: { expectedSizeBytes: true },
            where: { ownerId: input.ownerId },
          }),
        ]);

        if (pendingCount >= input.maxPendingPerUser) {
          throw new AppError("Too many uploads are pending.", 429, "ASSET_PENDING_LIMIT_REACHED");
        }
        if ((reserved._sum.expectedSizeBytes || 0) + input.expectedSizeBytes > input.userQuotaBytes) {
          throw new AppError("Storage quota reached.", 413, "ASSET_QUOTA_REACHED");
        }

        return tx.storedAsset.create({
          data: {
            declaredMimeType: input.declaredMimeType,
            checksumSha256: input.checksumSha256,
            expectedSizeBytes: input.expectedSizeBytes,
            objectKey: input.objectKey,
            originalName: input.originalName,
            ownerId: input.ownerId,
            projectId: input.projectId,
            purpose: input.purpose,
            uploadExpiresAt: input.uploadExpiresAt,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    },

    async enqueueAssetDeletion(ownerId, assetId) {
      return enqueueAssetDeletionForStatuses(database, ownerId, assetId, ["READY"], new Date());
    },

    async failValidatingAsset(ownerId, assetId, now) {
      return enqueueAssetDeletionForStatuses(database, ownerId, assetId, ["VALIDATING"], now);
    },

    async findOwnedAsset(ownerId, assetId) {
      return database.storedAsset.findFirst({ where: { id: assetId, ownerId } });
    },

    async claimCleanupBatch(now, leaseUntil, limit) {
      return database.$transaction(async (tx) => {
        const lockRows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtext('oddpath:asset-cleanup')) AS acquired
        `;
        if (!lockRows[0]?.acquired) {
          return {
            cleanupCandidatesMayRemain: false,
            cleanupQueued: 0,
            deletionBacklog: null,
            dueDeletionBacklog: null,
            jobs: [],
            lockAcquired: false,
          };
        }
        const candidates = await tx.storedAsset.findMany({
          orderBy: { id: "asc" },
          select: { id: true, objectKey: true, status: true, uploadExpiresAt: true },
          take: limit,
          where: {
            OR: [
              { status: "PENDING", uploadExpiresAt: { lte: new Date(now.getTime() - ASSET_UPLOAD_REPLAY_GRACE_MS) } },
              {
                status: "VALIDATING",
                validationStartedAt: { lte: new Date(now.getTime() - VALIDATION_LEASE_MS) },
              },
              { status: "FAILED" },
              {
                status: "READY",
                messageAttachment: null,
                sourceDocument: null,
                readyAt: { lte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
              },
            ],
          },
        });

        let cleanupQueued = 0;
        for (const candidate of candidates) {
          await lockAsset(tx, candidate.id);
          const claimed = await tx.storedAsset.updateMany({
            data: { status: "DELETE_PENDING" },
            where: {
              id: candidate.id,
              messageAttachment: null,
              sourceDocument: null,
              status: candidate.status,
            },
          });
          if (claimed.count !== 1) continue;
          cleanupQueued += 1;

          await enqueueAssetDeletionJobs(tx, [candidate], now);
        }

        // A restore reservation creates its deletion job before writing the
        // object. The job may therefore be due while its asset is still
        // PENDING. Claiming by job timestamp alone can race finalization and
        // delete an object that is about to become READY. A detached job is
        // also valid: account deletion intentionally removes StoredAsset rows
        // in the same transaction that preserves their durable outbox jobs.
        // Return only those detached jobs or jobs whose exact asset row is
        // already unreferenced DELETE_PENDING.
        const jobs = await tx.$queryRaw<
          Array<{ attempts: number; id: string; objectKey: string }>
        >(Prisma.sql`
          SELECT job."attempts", job."id", job."objectKey"
          FROM "ObjectDeletionJob" AS job
          LEFT JOIN "StoredAsset" AS asset
            ON asset."objectKey" = job."objectKey"
          WHERE job."nextAttemptAt" <= ${now}
            AND (
              asset."id" IS NULL
              OR (
                asset."status" = 'DELETE_PENDING'::"StoredAssetStatus"
                AND NOT EXISTS (
                  SELECT 1
                  FROM "MessageAttachment" AS attachment
                  WHERE attachment."assetId" = asset."id"
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM "ProjectDocument" AS document
                  WHERE document."sourceAssetId" = asset."id"
                )
              )
            )
          ORDER BY job."nextAttemptAt" ASC, job."id" ASC
          LIMIT ${limit}
          FOR UPDATE OF job SKIP LOCKED
        `);

        if (jobs.length > 0) {
          const leased = await tx.objectDeletionJob.updateMany({
            data: { nextAttemptAt: leaseUntil },
            where: { id: { in: jobs.map((job) => job.id) }, nextAttemptAt: { lte: now } },
          });
          if (leased.count !== jobs.length) {
            throw new Error("Deletion jobs could not be leased exactly once.");
          }
        }

        const [deletionBacklog, dueDeletionBacklog] = await Promise.all([
          tx.objectDeletionJob.count(),
          tx.objectDeletionJob.count({ where: { nextAttemptAt: { lte: now } } }),
        ]);

        return {
          cleanupCandidatesMayRemain: candidates.length === limit,
          cleanupQueued,
          deletionBacklog,
          dueDeletionBacklog,
          jobs: jobs.map((job) => ({ ...job, leaseUntil })),
          lockAcquired: true,
        };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      });
    },

    async markAssetFailed(ownerId, assetId) {
      await database.storedAsset.updateMany({
        data: { status: "FAILED" },
        where: { id: assetId, ownerId, status: "PENDING" },
      });
    },

    async releaseValidationClaim(ownerId, assetId) {
      await database.storedAsset.updateMany({
        data: { status: "PENDING", validationStartedAt: null },
        where: { id: assetId, ownerId, status: "VALIDATING" },
      });
    },

    async recordDeletionFailure(
      jobId,
      objectKey,
      leaseUntil,
      attempts,
      nextAttemptAt,
      lastError
    ) {
      const updated = await database.objectDeletionJob.updateMany({
        data: { attempts, lastError, nextAttemptAt },
        where: { id: jobId, nextAttemptAt: leaseUntil, objectKey },
      });
      return updated.count === 1;
    },

    async removeDeletedObject(jobId, objectKey, leaseUntil) {
      return database.$transaction(async (tx) => {
        // This compare-and-set is also a row lock for the rest of the
        // transaction. A worker whose lease was renewed by another instance
        // must not delete relational metadata or complete the newer claim.
        const owned = await tx.objectDeletionJob.updateMany({
          data: { nextAttemptAt: leaseUntil },
          where: { id: jobId, nextAttemptAt: leaseUntil, objectKey },
        });
        if (owned.count !== 1) return false;

        const asset = await tx.storedAsset.findUnique({
          select: {
            id: true,
            restoreAttempt: true,
            restoreSessionId: true,
          },
          where: { objectKey },
        });
        if (asset) {
          const deleted = await tx.storedAsset.deleteMany({
            where: {
              id: asset.id,
              messageAttachment: null,
              objectKey,
              sourceDocument: null,
              status: "DELETE_PENDING",
            },
          });
          if (deleted.count !== 1) {
            throw new Error(
              "Deletion job no longer targets an unreferenced DELETE_PENDING asset."
            );
          }

          if (asset.restoreSessionId && asset.restoreAttempt) {
            await tx.binaryAssetRestoreSession.deleteMany({
              where: {
                assets: { none: {} },
                attempt: asset.restoreAttempt,
                id: asset.restoreSessionId,
              },
            });
          }
        }

        const completed = await tx.objectDeletionJob.deleteMany({
          where: { id: jobId, nextAttemptAt: leaseUntil, objectKey },
        });
        if (completed.count !== 1) {
          throw new Error("Deletion job could not be completed exactly once.");
        }

        return true;
      }, { maxWait: 10_000, timeout: 30_000 });
    },

    async renewDeletionClaim(jobId, objectKey, currentLeaseUntil, renewedLeaseUntil) {
      const renewed = await database.objectDeletionJob.updateMany({
        data: { nextAttemptAt: renewedLeaseUntil },
        where: { id: jobId, nextAttemptAt: currentLeaseUntil, objectKey },
      });
      return renewed.count === 1;
    },

  };
}

const VALIDATION_LEASE_MS = 15 * 60 * 1000;

async function enqueueAssetDeletionForStatuses(
  database: typeof prisma,
  ownerId: string,
  assetId: string,
  statuses: Array<"PENDING" | "READY" | "VALIDATING">,
  now: Date
) {
  return database.$transaction(async (tx) => {
    await lockAsset(tx, assetId);
    const asset = await tx.storedAsset.findFirst({
      select: { objectKey: true, uploadExpiresAt: true },
      where: {
        id: assetId,
        ownerId,
        status: { in: statuses },
        ...(statuses.includes("READY") ? { messageAttachment: null, sourceDocument: null } : {}),
      },
    });

    if (!asset) return null;

    await enqueueAssetDeletionJobs(tx, [asset], now);
    await tx.storedAsset.update({
      data: { status: "DELETE_PENDING" },
      where: { id: assetId },
    });

    return asset.objectKey;
  });
}

async function lockAsset(tx: Prisma.TransactionClient, assetId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:asset:${assetId}`}, 0))`;
}

async function withSerializableRetry<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === 2) throw error;
    }
  }

  throw new Error("Unreachable serializable reservation retry state.");
}

function isSerializationConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as Record<string, unknown>).code;
  return code === "P2034" || code === "40001";
}

export const assetsRepository = createPrismaAssetsRepository();
