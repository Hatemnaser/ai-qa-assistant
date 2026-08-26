import { isCloudflareEuR2Endpoint } from "../checks.js";
import type { AppEnv } from "../load.js";

export function validatePrivateAssetEnv(config: AppEnv) {
  if (config.nodeEnv === "production" && config.privateAssetsEnabled) {
    throw new Error(
      "Unsafe production private asset configuration: PRIVATE_ASSETS_ENABLED must remain false until the real PostgreSQL restore/cleanup and concurrency gate, EU R2 interruption smoke, production-scale latency/timeout proof, and monitored scheduled cleanup validation pass."
    );
  }

  const hasAnyR2Configuration = Boolean(
    config.r2Endpoint ||
      config.r2BucketName ||
      config.r2AccessKeyId ||
      config.r2SecretAccessKey ||
      config.r2Region !== "auto"
  );
  if (!config.privateAssetsEnabled && !hasAnyR2Configuration) return;

  if (
    !config.r2Endpoint ||
    !config.r2BucketName ||
    !config.r2AccessKeyId ||
    !config.r2SecretAccessKey
  ) {
    throw new Error(
      "Unsafe private asset configuration: R2 endpoint, bucket, access key ID, and secret access key are required when PRIVATE_ASSETS_ENABLED=true."
    );
  }

  if (!isCloudflareEuR2Endpoint(config.r2Endpoint)) {
    throw new Error(
      "Unsafe private asset configuration: R2_ENDPOINT must be the account EU-jurisdiction endpoint https://<account>.eu.r2.cloudflarestorage.com."
    );
  }

  if (config.r2Region !== "auto") {
    throw new Error("Unsafe private asset configuration: R2_REGION must be auto.");
  }

  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.r2BucketName)) {
    throw new Error("Unsafe private asset configuration: R2_BUCKET_NAME is invalid.");
  }

  if (config.assetUploadUrlTtlSeconds > 900 || config.assetDownloadUrlTtlSeconds > 900) {
    throw new Error(
      "Unsafe private asset configuration: presigned URL TTLs must not exceed 900 seconds."
    );
  }

  if (
    config.assetMaxImageBytes > 4 * 1024 * 1024 ||
    config.assetMaxTextBytes > 1024 * 1024
  ) {
    throw new Error(
      "Unsafe private asset configuration: per-file limits exceed the initial release policy."
    );
  }

  if (config.assetUserQuotaBytes < Math.max(config.assetMaxImageBytes, config.assetMaxTextBytes)) {
    throw new Error(
      "Unsafe private asset configuration: ASSET_USER_QUOTA_BYTES is below a permitted file size."
    );
  }
}
