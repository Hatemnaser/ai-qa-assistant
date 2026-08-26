import {
  parseStrictBoolean,
  parseStrictPositiveInteger,
} from "../parsers.js";
import type { EnvLoadContext } from "../types.js";

export function loadStorageEnv({ source }: EnvLoadContext) {
  return {
    privateAssetsEnabled: parseStrictBoolean(
      source.PRIVATE_ASSETS_ENABLED,
      false,
      "PRIVATE_ASSETS_ENABLED"
    ),
    r2Endpoint: source.R2_ENDPOINT?.trim() || "",
    r2Region: source.R2_REGION?.trim() || "auto",
    r2BucketName: source.R2_BUCKET_NAME?.trim() || "",
    r2AccessKeyId: source.R2_ACCESS_KEY_ID?.trim() || "",
    r2SecretAccessKey: source.R2_SECRET_ACCESS_KEY || "",
    assetUploadUrlTtlSeconds: parseStrictPositiveInteger(
      source.ASSET_UPLOAD_URL_TTL_SECONDS,
      600,
      "ASSET_UPLOAD_URL_TTL_SECONDS"
    ),
    assetDownloadUrlTtlSeconds: parseStrictPositiveInteger(
      source.ASSET_DOWNLOAD_URL_TTL_SECONDS,
      300,
      "ASSET_DOWNLOAD_URL_TTL_SECONDS"
    ),
    assetMaxImageBytes: parseStrictPositiveInteger(
      source.ASSET_MAX_IMAGE_BYTES,
      4 * 1024 * 1024,
      "ASSET_MAX_IMAGE_BYTES"
    ),
    assetMaxTextBytes: parseStrictPositiveInteger(
      source.ASSET_MAX_TEXT_BYTES,
      1024 * 1024,
      "ASSET_MAX_TEXT_BYTES"
    ),
    assetUserQuotaBytes: parseStrictPositiveInteger(
      source.ASSET_USER_QUOTA_BYTES,
      50 * 1024 * 1024,
      "ASSET_USER_QUOTA_BYTES"
    ),
    assetMaxPendingPerUser: parseStrictPositiveInteger(
      source.ASSET_MAX_PENDING_PER_USER,
      4,
      "ASSET_MAX_PENDING_PER_USER"
    ),
    assetCleanupBatchSize: parseStrictPositiveInteger(
      source.ASSET_CLEANUP_BATCH_SIZE,
      100,
      "ASSET_CLEANUP_BATCH_SIZE"
    ),
    assetInitiateRateLimitWindowMs: parseStrictPositiveInteger(
      source.ASSET_INITIATE_RATE_LIMIT_WINDOW_MS,
      60_000,
      "ASSET_INITIATE_RATE_LIMIT_WINDOW_MS"
    ),
    assetInitiateRateLimitMax: parseStrictPositiveInteger(
      source.ASSET_INITIATE_RATE_LIMIT_MAX,
      20,
      "ASSET_INITIATE_RATE_LIMIT_MAX"
    ),
  };
}
