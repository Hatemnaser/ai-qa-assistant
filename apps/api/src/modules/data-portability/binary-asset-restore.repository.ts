import { prisma } from "../../db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { enqueueAssetDeletionJobs } from "../assets/assets.deletion-outbox.js";
import type {
  BinaryAssetRestoreRepository,
  BinaryAssetRestoreReservation,
} from "./binary-asset-restore.types.js";
import {
  PORTABILITY_CLEANUP_TRANSACTION_OPTIONS,
  PORTABILITY_SERIALIZABLE_TRANSACTION_OPTIONS,
  withSerializableTransactionRetry,
} from "./portability-transaction.js";

export function createPrismaBinaryAssetRestoreRepository(
  database: typeof prisma = prisma
): BinaryAssetRestoreRepository {
  return {
    async assertAttemptActive(ownerId, reservations, now) {
      if (reservations.length === 0) return false;
      const fence = getRestoreFence(reservations);

      return database.$transaction(async (tx) => {
        await lockRestoreSession(tx, fence.sessionId);
        const session = await tx.binaryAssetRestoreSession.findFirst({
          select: { id: true },
          where: {
            attempt: fence.attempt,
            attemptToken: fence.attemptToken,
            id: fence.sessionId,
            leaseExpiresAt: { gt: now },
            ownerId,
          },
        });
        if (!session) return false;

        const objectKeys = reservations.map((reservation) => reservation.objectKey);
        const [stagedRows, deletionJobs] = await Promise.all([
          tx.storedAsset.findMany({
            select: {
              id: true,
              objectKey: true,
              restoreAttempt: true,
              restoreSessionId: true,
            },
            where: {
              ownerId,
              restoreAttempt: fence.attempt,
              restoreSessionId: fence.sessionId,
              status: "PENDING",
            },
          }),
          tx.objectDeletionJob.findMany({
            select: { objectKey: true },
            where: { objectKey: { in: objectKeys } },
          }),
        ]);

        return hasExactRestoreRows(reservations, stagedRows, deletionJobs);
      }, PORTABILITY_CLEANUP_TRANSACTION_OPTIONS);
    },

    async stage(ownerId, reservations, startedAt, cleanupNotBefore, userQuotaBytes) {
      if (reservations.length === 0) return;
      const fence = getRestoreFence(reservations);
      if (cleanupNotBefore.getTime() <= startedAt.getTime()) {
        throwRestoreStateInvalid();
      }

      await withSerializableTransactionRetry(() =>
        database.$transaction(
          async (tx) => {
            // Use the same owner-scoped lock as interactive upload reservations,
            // so an import and a signed upload cannot overbook storage together.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`;
            await lockRestoreSession(tx, fence.sessionId);
            await createRestoreSession(tx, ownerId, fence, cleanupNotBefore);

            const reserved = await tx.storedAsset.aggregate({
              _sum: { expectedSizeBytes: true },
              where: { ownerId },
            });
            const requestedBytes = reservations.reduce(
              (total, reservation) =>
                total + reservation.descriptor.sizeBytes,
              0
            );

            if (
              !Number.isSafeInteger(userQuotaBytes) ||
              userQuotaBytes < 1 ||
              requestedBytes > userQuotaBytes ||
              (reserved._sum.expectedSizeBytes || 0) >
                userQuotaBytes - requestedBytes
            ) {
              throw new AppError(
                "Storage quota reached.",
                413,
                "ASSET_QUOTA_REACHED"
              );
            }

            for (const reservation of reservations) {
              const descriptor = reservation.descriptor;
              await tx.storedAsset.create({
                data: {
                  checksumSha256: descriptor.checksumSha256,
                  declaredMimeType: descriptor.mimeType,
                  expectedSizeBytes: descriptor.sizeBytes,
                  id: reservation.assetId,
                  objectKey: reservation.objectKey,
                  originalName: descriptor.originalName,
                  ownerId,
                  projectId: null,
                  purpose: descriptor.purpose,
                  restoreAttempt: fence.attempt,
                  restoreSessionId: fence.sessionId,
                  uploadExpiresAt: cleanupNotBefore,
                },
              });
            }

            await enqueueAssetDeletionJobs(
              tx,
              reservations.map((reservation) => ({
                objectKey: reservation.objectKey,
                uploadExpiresAt: cleanupNotBefore,
              }))
            );
          },
          PORTABILITY_SERIALIZABLE_TRANSACTION_OPTIONS
        )
      );
    },

    async markForCleanup(ownerId, reservations, cleanupNotBefore) {
      if (reservations.length === 0) return [];
      const fence = getRestoreFence(reservations);

      return database.$transaction(async (tx) => {
        await lockRestoreSession(tx, fence.sessionId);
        const session = await tx.binaryAssetRestoreSession.findFirst({
          select: { id: true },
          where: {
            attempt: fence.attempt,
            attemptToken: fence.attemptToken,
            id: fence.sessionId,
            ownerId,
          },
        });
        const claimedObjectKeys: string[] = [];
        for (const reservation of reservations) {
          const current = await tx.storedAsset.findUnique({
            select: {
              id: true,
              messageAttachment: { select: { id: true } },
              objectKey: true,
              ownerId: true,
              restoreAttempt: true,
              restoreSessionId: true,
              sourceDocument: { select: { id: true } },
              status: true,
            },
            where: { id: reservation.assetId },
          });

          // A late provider acknowledgement can arrive after cleanup already
          // deleted the staged row and outbox job. Recreate a detached job so
          // that late object cannot become an orphan.
          if (!current) {
            claimedObjectKeys.push(reservation.objectKey);
            continue;
          }
          if (
            !session ||
            current.objectKey !== reservation.objectKey ||
            current.ownerId !== ownerId ||
            current.restoreAttempt !== fence.attempt ||
            current.restoreSessionId !== fence.sessionId ||
            current.messageAttachment ||
            current.sourceDocument
          ) {
            continue;
          }
          if (current.status === "DELETE_PENDING") {
            claimedObjectKeys.push(reservation.objectKey);
            continue;
          }
          if (current.status !== "PENDING") continue;

          const claimed = await tx.storedAsset.updateMany({
            data: { status: "DELETE_PENDING", uploadExpiresAt: null },
            where: {
              id: reservation.assetId,
              messageAttachment: null,
              objectKey: reservation.objectKey,
              ownerId,
              restoreAttempt: fence.attempt,
              restoreSessionId: fence.sessionId,
              sourceDocument: null,
              status: "PENDING",
            },
          });
          if (claimed.count === 1) {
            claimedObjectKeys.push(reservation.objectKey);
          }
        }

        if (claimedObjectKeys.length > 0) {
          await enqueueAssetDeletionJobs(
            tx,
            claimedObjectKeys.map((objectKey) => ({ objectKey })),
            cleanupNotBefore
          );
          await tx.objectDeletionJob.updateMany({
            data: { nextAttemptAt: cleanupNotBefore },
            where: {
              objectKey: { in: claimedObjectKeys },
            },
          });
        }
        return claimedObjectKeys;
      }, PORTABILITY_CLEANUP_TRANSACTION_OPTIONS);
    },

  };
}

async function createRestoreSession(
  tx: Prisma.TransactionClient,
  ownerId: string,
  fence: ReturnType<typeof getRestoreFence>,
  leaseExpiresAt: Date
) {
  if (fence.attempt !== 1) throwRestoreStateInvalid();
  await tx.binaryAssetRestoreSession.create({
    data: {
      attempt: fence.attempt,
      attemptToken: fence.attemptToken,
      id: fence.sessionId,
      leaseExpiresAt,
      ownerId,
    },
  });
}

function getRestoreFence(
  reservations: readonly BinaryAssetRestoreReservation[]
) {
  const fence = reservations[0]?.fence;
  if (
    !fence ||
    !Number.isSafeInteger(fence.attempt) ||
    fence.attempt < 1 ||
    !fence.attemptToken ||
    !fence.sessionId ||
    reservations.some(
      (reservation) =>
        reservation.fence.attempt !== fence.attempt ||
        reservation.fence.attemptToken !== fence.attemptToken ||
        reservation.fence.sessionId !== fence.sessionId
    )
  ) {
    throwRestoreStateInvalid();
  }
  return fence;
}

function hasExactRestoreRows(
  reservations: readonly BinaryAssetRestoreReservation[],
  stagedRows: readonly {
    id: string;
    objectKey: string;
    restoreAttempt: number | null;
    restoreSessionId: string | null;
  }[],
  deletionJobs: readonly { objectKey: string }[]
) {
  if (
    stagedRows.length !== reservations.length ||
    deletionJobs.length !== reservations.length
  ) {
    return false;
  }
  const stagedById = new Map(stagedRows.map((row) => [row.id, row]));
  const jobKeys = new Set(deletionJobs.map((job) => job.objectKey));
  return reservations.every((reservation) => {
    const row = stagedById.get(reservation.assetId);
    return Boolean(
      row &&
        row.objectKey === reservation.objectKey &&
        row.restoreAttempt === reservation.fence.attempt &&
        row.restoreSessionId === reservation.fence.sessionId &&
        jobKeys.has(reservation.objectKey)
    );
  });
}

async function lockRestoreSession(
  tx: Prisma.TransactionClient,
  sessionId: string
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:asset-restore:${sessionId}`}, 0))`;
}

function throwRestoreStateInvalid(): never {
  throw new AppError(
    "Private asset restore state is invalid.",
    409,
    "ASSET_RESTORE_STATE_INVALID"
  );
}

export const binaryAssetRestoreRepository =
  createPrismaBinaryAssetRestoreRepository();
