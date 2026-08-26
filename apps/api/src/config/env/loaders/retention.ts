import { parseStrictPositiveSafeInteger } from "../parsers.js";
import type { EnvLoadContext } from "../types.js";

export function loadRetentionEnv({ source }: EnvLoadContext) {
  return {
    authTokenRetentionDays: parseStrictPositiveSafeInteger(
      source.AUTH_TOKEN_RETENTION_DAYS,
      7,
      "AUTH_TOKEN_RETENTION_DAYS"
    ),
    unverifiedAccountRetentionDays: parseStrictPositiveSafeInteger(
      source.UNVERIFIED_ACCOUNT_RETENTION_DAYS,
      7,
      "UNVERIFIED_ACCOUNT_RETENTION_DAYS"
    ),
    usageRecordRetentionDays: parseStrictPositiveSafeInteger(
      source.USAGE_RECORD_RETENTION_DAYS,
      32,
      "USAGE_RECORD_RETENTION_DAYS"
    ),
    retentionCleanupBatchSize: parseStrictPositiveSafeInteger(
      source.RETENTION_CLEANUP_BATCH_SIZE,
      100,
      "RETENTION_CLEANUP_BATCH_SIZE"
    ),
  };
}
