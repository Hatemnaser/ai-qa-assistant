import { randomBytes, randomUUID } from "node:crypto";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { AssetPurpose } from "../assets/assets.types.js";
import { assetStorage, type AssetStorage } from "../assets/assets.storage.js";
import { BINARY_ASSET_PORTABILITY_LIMITS } from "./binary-assets.js";
import { binaryAssetRestoreRepository } from "./binary-asset-restore.repository.js";
import type {
  BinaryAssetRestoreFence,
  BinaryAssetRestoreRepository,
  BinaryAssetRestoreReservation,
  BinaryAssetRestoreService,
  UploadedPortableBinaryAsset,
} from "./binary-asset-restore.types.js";

const RESTORE_CLEANUP_LEASE_MS = 30 * 60 * 1_000;
const RESTORE_AMBIGUOUS_WRITE_QUARANTINE_MS = 5 * 60 * 1_000;

export interface BinaryAssetRestoreServiceDependencies {
  config?: Pick<
    typeof env,
    "assetUserQuotaBytes" | "privateAssetsEnabled"
  >;
  createAssetId?: () => string;
  createAttemptToken?: () => string;
  createObjectKey?: (purpose: AssetPurpose, now: Date) => string;
  createSessionId?: () => string;
  now?: () => Date;
  repository: BinaryAssetRestoreRepository;
  storage: Pick<AssetStorage, "writeObject">;
}

export function createBinaryAssetRestoreService({
  config = env,
  createAssetId = () => randomUUID(),
  createAttemptToken = () => randomUUID(),
  createObjectKey = defaultRestoreObjectKey,
  createSessionId = () => randomUUID(),
  now = () => new Date(),
  repository,
  storage,
}: BinaryAssetRestoreServiceDependencies): BinaryAssetRestoreService {
  return {
    async runWithPreparedAssets(ownerId, assets, commit) {
      if (assets.length === 0) return commit([]);
      if (!config.privateAssetsEnabled) {
        throw new AppError(
          "Private asset storage is unavailable.",
          503,
          "ASSET_STORAGE_DISABLED"
        );
      }
      if (assets.length > BINARY_ASSET_PORTABILITY_LIMITS.maxAssets) {
        throwInvalidRestoreInput();
      }

      const startedAt = now();
      const fence = createRestoreFence(createSessionId, createAttemptToken);
      const reservations = createReservations(
        assets,
        startedAt,
        fence,
        createAssetId,
        createObjectKey
      );
      const cleanupNotBefore = new Date(
        startedAt.getTime() + RESTORE_CLEANUP_LEASE_MS
      );

      await repository.stage(
        ownerId,
        reservations,
        startedAt,
        cleanupNotBefore,
        config.assetUserQuotaBytes
      );

      try {
        const uploaded: UploadedPortableBinaryAsset[] = [];
        for (const [index, reservation] of reservations.entries()) {
          await assertRestoreAttemptActive(
            ownerId,
            reservations,
            repository,
            now(),
            cleanupNotBefore
          );
          const asset = assets[index]!;
          const storedObject = await storage.writeObject({
            bytes: asset.bytes,
            checksumSha256: reservation.descriptor.checksumSha256,
            contentType: reservation.descriptor.mimeType,
            maximumBytes: BINARY_ASSET_PORTABILITY_LIMITS.maxAssetBytes,
            objectKey: reservation.objectKey,
          });
          uploaded.push({ ...reservation, storedObject });
          await assertRestoreAttemptActive(
            ownerId,
            reservations,
            repository,
            now(),
            cleanupNotBefore
          );
        }

        await assertRestoreAttemptActive(
          ownerId,
          reservations,
          repository,
          now(),
          cleanupNotBefore
        );
        return await commit(uploaded);
      } catch (error) {
        await scheduleFailedRestoreCleanup(
          ownerId,
          reservations,
          repository,
          new Date(now().getTime() + RESTORE_AMBIGUOUS_WRITE_QUARANTINE_MS)
        );
        if (isAppError(error)) throw error;
        throw new AppError(
          "Private assets could not be restored safely.",
          503,
          "ASSET_RESTORE_FAILED"
        );
      }
    },
  };
}

function createReservations(
  assets: Parameters<BinaryAssetRestoreService["runWithPreparedAssets"]>[1],
  now: Date,
  fence: BinaryAssetRestoreFence,
  createAssetId: () => string,
  createObjectKey: (purpose: AssetPurpose, now: Date) => string
) {
  const assetIds = new Set<string>();
  const objectKeys = new Set<string>();

  return assets.map((asset) => {
    const assetId = createAssetId();
    const objectKey = createObjectKey(asset.purpose, now);
    if (
      !assetId ||
      assetId.length > 120 ||
      /[\u0000-\u001f\u007f]/u.test(assetId) ||
      !objectKey ||
      objectKey.length > 1_024 ||
      /[\u0000-\u001f\u007f]/u.test(objectKey) ||
      assetIds.has(assetId) ||
      objectKeys.has(objectKey)
    ) {
      throwInvalidRestoreInput();
    }

    assetIds.add(assetId);
    objectKeys.add(objectKey);
    const { bytes: _bytes, ...descriptor } = asset;
    return { assetId, descriptor, fence, objectKey };
  });
}

function createRestoreFence(
  createSessionId: () => string,
  createAttemptToken: () => string
): BinaryAssetRestoreFence {
  const sessionId = createSessionId();
  const attemptToken = createAttemptToken();
  if (
    !sessionId ||
    sessionId.length > 120 ||
    /[\u0000-\u001f\u007f]/u.test(sessionId) ||
    !attemptToken ||
    attemptToken.length > 240 ||
    /[\u0000-\u001f\u007f]/u.test(attemptToken)
  ) {
    throwInvalidRestoreInput();
  }

  return { attempt: 1, attemptToken, sessionId };
}

async function scheduleFailedRestoreCleanup(
  ownerId: string,
  reservations: readonly BinaryAssetRestoreReservation[],
  repository: BinaryAssetRestoreRepository,
  cleanupNotBefore: Date
) {
  try {
    await repository.markForCleanup(
      ownerId,
      reservations,
      cleanupNotBefore
    );
  } catch {
    // The durable jobs were created before any write. If the database is
    // temporarily unavailable they remain scheduled for eventual cleanup.
    // Do not delete blindly: the database commit may have succeeded while its
    // acknowledgement was lost.
    return;
  }
}

function assertRestoreLeaseActive(now: Date, cleanupNotBefore: Date) {
  if (now.getTime() >= cleanupNotBefore.getTime()) {
    throw new Error("Binary asset restore exceeded its staging lease.");
  }
}

async function assertRestoreAttemptActive(
  ownerId: string,
  reservations: readonly BinaryAssetRestoreReservation[],
  repository: BinaryAssetRestoreRepository,
  currentTime: Date,
  cleanupNotBefore: Date
) {
  assertRestoreLeaseActive(currentTime, cleanupNotBefore);
  if (
    !(await repository.assertAttemptActive(
      ownerId,
      reservations,
      currentTime
    ))
  ) {
    throw new Error("Binary asset restore attempt was fenced.");
  }
}

function defaultRestoreObjectKey(purpose: AssetPurpose, now: Date) {
  const prefix =
    purpose === "CHAT_ATTACHMENT"
      ? "chat-attachments"
      : "project-documents";
  const date = now.toISOString().slice(0, 10).replaceAll("-", "/");
  return `${prefix}/${date}/restore-${randomBytes(24).toString("hex")}`;
}

function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

function throwInvalidRestoreInput(): never {
  throw new AppError(
    "Portable private asset data is invalid.",
    400,
    "ASSET_PORTABILITY_PACKAGE_INVALID"
  );
}

export const binaryAssetRestoreService = createBinaryAssetRestoreService({
  repository: binaryAssetRestoreRepository,
  storage: assetStorage,
});
