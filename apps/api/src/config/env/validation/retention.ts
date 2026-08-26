import type { AppEnv } from "../load.js";

export function validateRetentionEnv(config: AppEnv) {
  if (
    config.authTokenRetentionDays > 3650 ||
    config.unverifiedAccountRetentionDays > 3650 ||
    config.usageRecordRetentionDays > 3650
  ) {
    throw new Error("Unsafe retention configuration: retention periods must not exceed 3650 days.");
  }

  if (config.usageRecordRetentionDays < 32) {
    throw new Error(
      "Unsafe retention configuration: USAGE_RECORD_RETENTION_DAYS must be at least 32 days for monthly AI budget accounting."
    );
  }

  if (config.retentionCleanupBatchSize > 1_000) {
    throw new Error(
      "Unsafe retention configuration: RETENTION_CLEANUP_BATCH_SIZE must not exceed 1000."
    );
  }
}
