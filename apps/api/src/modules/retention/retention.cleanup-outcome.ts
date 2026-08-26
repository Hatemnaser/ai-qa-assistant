import type { RetentionDrainResult } from "./retention.types.js";

export interface RetentionCleanupOutcome {
  exitCode: 0 | 1;
  level: "error" | "info" | "warn";
  status: "completed" | "failed" | "overlap_skipped";
}

/**
 * Maps a bounded drain result to both structured telemetry and the scheduler
 * process contract. A successful overlapping invocation is only the one that
 * did no work because another instance already owns cleanup.
 */
export function getRetentionCleanupOutcome(
  result: Pick<RetentionDrainResult, "batches" | "stopReason">
): RetentionCleanupOutcome {
  if (result.stopReason === "drained") {
    return { exitCode: 0, level: "info", status: "completed" };
  }
  if (result.stopReason === "overlap" && result.batches === 0) {
    return { exitCode: 0, level: "warn", status: "overlap_skipped" };
  }

  return { exitCode: 1, level: "error", status: "failed" };
}
