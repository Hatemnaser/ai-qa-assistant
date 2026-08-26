import { randomBytes } from "node:crypto";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import {
  projectAccessService,
  type ProjectAccessService,
} from "../projects/project-access.service.js";
import { assertSupportedAsset, detectAssetMime, isImageMime } from "./assets.policy.js";
import { assetsRepository } from "./assets.repository.js";
import { assetStorage, type AssetStorage } from "./assets.storage.js";
import type {
  AssetPurpose,
  AssetsRepository,
  CompleteAssetInput,
  InitiateAssetInput,
} from "./assets.types.js";

export interface AssetsServiceDependencies {
  config?: Pick<
    typeof env,
    | "assetDownloadUrlTtlSeconds"
    | "assetMaxImageBytes"
    | "assetMaxPendingPerUser"
    | "assetMaxTextBytes"
    | "assetUploadUrlTtlSeconds"
    | "assetUserQuotaBytes"
    | "privateAssetsEnabled"
  >;
  createObjectKey?: (purpose: AssetPurpose, createdAt: Date) => string;
  now?: () => Date;
  projectAccess: ProjectAccessService;
  repository: AssetsRepository;
  storage: AssetStorage;
}

export function createAssetsService({
  config = env,
  createObjectKey = defaultObjectKey,
  now = () => new Date(),
  projectAccess,
  repository,
  storage,
}: AssetsServiceDependencies) {
  async function initiateUpload(userId: string, input: InitiateAssetInput) {
    assertEnabled();
    assertSupportedAsset({
      maxImageBytes: config.assetMaxImageBytes,
      maxTextBytes: config.assetMaxTextBytes,
      mimeType: input.declaredMimeType,
      originalName: input.originalName,
      purpose: input.purpose,
      sizeBytes: input.expectedSizeBytes,
    });

    if (input.purpose === "PROJECT_DOCUMENT_SOURCE" && !input.projectId) {
      throw new AppError("Project document assets require a project.", 400, "ASSET_PROJECT_REQUIRED");
    }

    if (input.projectId) {
      await projectAccess.assertProjectAccess(userId, input.projectId);
    }

    const createdAt = now();
    const uploadExpiresAt = new Date(createdAt.getTime() + config.assetUploadUrlTtlSeconds * 1000);
    const asset = await repository.createPendingAssetReservation({
      ...input,
      maxPendingPerUser: config.assetMaxPendingPerUser,
      objectKey: createObjectKey(input.purpose, createdAt),
      ownerId: userId,
      uploadExpiresAt,
      userQuotaBytes: config.assetUserQuotaBytes,
    });

    try {
      const upload = await storage.createUploadUrl({
        checksumSha256: input.checksumSha256,
        contentLength: input.expectedSizeBytes,
        contentType: input.declaredMimeType,
        expiresInSeconds: config.assetUploadUrlTtlSeconds,
        objectKey: asset.objectKey,
      });

      return {
        asset: toAssetDto(asset),
        upload: {
          expiresAt: uploadExpiresAt.toISOString(),
          headers: upload.headers,
          method: "PUT" as const,
          url: upload.url,
        },
      };
    } catch (error) {
      await repository.markAssetFailed(userId, asset.id);
      throw error;
    }
  }

  async function completeUpload(userId: string, assetId: string, input: CompleteAssetInput) {
    assertEnabled();
    const completedAt = now();
    const asset = await repository.claimPendingAssetForValidation(userId, assetId, completedAt);

    if (!asset) {
      const existing = await repository.findOwnedAsset(userId, assetId);
      if (existing?.status === "READY") return toAssetDto(existing);
      if (existing?.status === "VALIDATING") {
        throw new AppError("Asset validation is already in progress.", 409, "ASSET_VALIDATION_IN_PROGRESS");
      }
      if (existing?.status === "PENDING" && existing.uploadExpiresAt && existing.uploadExpiresAt <= completedAt) {
        await failAndQueue(userId, assetId, completedAt);
        throw new AppError("Upload has expired.", 410, "ASSET_UPLOAD_EXPIRED");
      }
      throw new AppError("Asset was not found.", 404, "ASSET_NOT_FOUND");
    }

    if (input.checksumSha256 !== asset.checksumSha256) {
      await failAndQueue(userId, assetId, completedAt);
      throw new AppError("Uploaded object checksum is invalid.", 422, "ASSET_VALIDATION_FAILED");
    }

    let metadata;
    try {
      metadata = await storage.inspectObject(asset.objectKey);
    } catch (error) {
      await repository.releaseValidationClaim(userId, assetId);
      if (isMissingStoredObject(error)) {
        throw new AppError("Uploaded object was not found.", 409, "ASSET_UPLOAD_INCOMPLETE");
      }
      throw new AppError("Asset validation is temporarily unavailable.", 503, "ASSET_VALIDATION_UNAVAILABLE");
    }

    const metadataMatches =
      metadata.contentLength === asset.expectedSizeBytes &&
      metadata.contentType === asset.declaredMimeType &&
      Boolean(metadata.checksumSha256) &&
      metadata.checksumSha256 === asset.checksumSha256;

    if (!metadataMatches) {
      await failAndQueue(userId, assetId, completedAt);
      throw new AppError("Uploaded object did not match its signed metadata.", 422, "ASSET_VALIDATION_FAILED");
    }

    let sample;
    const validationReadSize = isImageMime(asset.declaredMimeType)
      ? Math.min(asset.expectedSizeBytes, MAX_IMAGE_VALIDATION_SAMPLE_BYTES)
      : asset.expectedSizeBytes;
    try {
      sample = await storage.readObjectSample(asset.objectKey, validationReadSize);
    } catch {
      await repository.releaseValidationClaim(userId, assetId);
      throw new AppError("Asset validation is temporarily unavailable.", 503, "ASSET_VALIDATION_UNAVAILABLE");
    }

    if (sample.bytes.byteLength !== validationReadSize) {
      await repository.releaseValidationClaim(userId, assetId);
      throw new AppError("Asset validation is temporarily unavailable.", 503, "ASSET_VALIDATION_UNAVAILABLE");
    }
    const detectedMimeType = detectAssetMime(sample.bytes, asset.declaredMimeType);

    if (!detectedMimeType || detectedMimeType !== asset.declaredMimeType) {
      await failAndQueue(userId, assetId, completedAt);
      throw new AppError("Uploaded object content is invalid.", 422, "ASSET_VALIDATION_FAILED");
    }

    const completed = await repository.completeValidatingAsset({
      assetId,
      detectedMimeType,
      etag: metadata.etag,
      ownerId: userId,
      readyAt: completedAt,
      sizeBytes: metadata.contentLength,
    });

    if (!completed) {
      throw new AppError("Asset was not found.", 404, "ASSET_NOT_FOUND");
    }

    return toAssetDto(completed);
  }

  async function getDownloadUrl(userId: string, assetId: string) {
    assertEnabled();
    const asset = await repository.findOwnedAsset(userId, assetId);

    if (!asset || asset.status !== "READY") {
      throw new AppError("Asset was not found.", 404, "ASSET_NOT_FOUND");
    }

    const url = await storage.createDownloadUrl(asset.objectKey, config.assetDownloadUrlTtlSeconds);

    return {
      asset: toAssetDto(asset),
      download: {
        expiresAt: new Date(now().getTime() + config.assetDownloadUrlTtlSeconds * 1000).toISOString(),
        url,
      },
    };
  }

  async function cancelUpload(userId: string, assetId: string) {
    assertEnabled();
    const queued =
      (await repository.cancelPendingAsset(userId, assetId, now())) ||
      (await repository.enqueueAssetDeletion(userId, assetId));

    if (!queued) {
      throw new AppError("Asset was not found.", 404, "ASSET_NOT_FOUND");
    }

    return { ok: true as const };
  }

  async function failAndQueue(userId: string, assetId: string, failedAt: Date) {
    const queued = await repository.failValidatingAsset(userId, assetId, failedAt);
    if (!queued) await repository.markAssetFailed(userId, assetId);
  }

  function assertEnabled() {
    if (!config.privateAssetsEnabled) {
      throw new AppError("Private asset storage is unavailable.", 503, "ASSET_STORAGE_DISABLED");
    }
  }

  return {
    cancelUpload,
    completeUpload,
    getDownloadUrl,
    initiateUpload,
  };
}

const MAX_IMAGE_VALIDATION_SAMPLE_BYTES = 64 * 1024;

function isMissingStoredObject(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const metadata = record.$metadata;

  return (
    record.name === "NoSuchKey" ||
    record.name === "NotFound" ||
    Boolean(
      metadata &&
      typeof metadata === "object" &&
      (metadata as Record<string, unknown>).httpStatusCode === 404
    )
  );
}

function defaultObjectKey(purpose: AssetPurpose, createdAt: Date) {
  const prefix = purpose === "CHAT_ATTACHMENT" ? "chat-attachments" : "project-documents";
  const date = createdAt.toISOString().slice(0, 10).replaceAll("-", "/");
  return `${prefix}/${date}/${randomBytes(24).toString("hex")}`;
}

function toAssetDto(asset: Awaited<ReturnType<AssetsRepository["findOwnedAsset"]>> & object) {
  return {
    createdAt: asset.createdAt.toISOString(),
    declaredMimeType: asset.declaredMimeType,
    detectedMimeType: asset.detectedMimeType,
    expectedSizeBytes: asset.expectedSizeBytes,
    id: asset.id,
    originalName: asset.originalName,
    projectId: asset.projectId,
    purpose: asset.purpose,
    readyAt: asset.readyAt?.toISOString() || null,
    sizeBytes: asset.sizeBytes,
    status: asset.status,
  };
}

export const assetsService = createAssetsService({
  projectAccess: projectAccessService,
  repository: assetsRepository,
  storage: assetStorage,
});
