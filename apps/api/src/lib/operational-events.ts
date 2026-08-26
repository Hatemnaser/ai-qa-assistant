export type OperationalLogLevel = "error" | "info" | "warn";

export type OperationalEvent =
  | {
      cacheHits: number;
      coalescedRequests: number;
      durationMs: number;
      event: "readiness_probe";
      failFastRequests: number;
      outcome: "ready" | "timeout" | "unavailable";
      probesStarted: number;
    }
  | {
      batchSize: number;
      batches: number;
      durationMs: number;
      event: "retention_cleanup";
      lockAcquired: boolean;
      mayHaveMore: boolean;
      removed: {
        aiUsageLogs: number;
        authEmailJobs: number;
        expiredAuthEmailJobsCancelled: number;
        emailVerificationTokens: number;
        passwordResetTokens: number;
        sessions: number;
        unverifiedAccounts: number;
        usageEvents: number;
      };
      status: "completed" | "failed" | "overlap_skipped";
      stopReason: "drained" | "error" | "max_batches" | "no_progress" | "overlap";
    }
  | {
      cleanupQueued: number;
      cleanupCandidatesMayRemain: boolean;
      deleted: number;
      deletionBacklog: number | null;
      dueDeletionBacklog: number | null;
      durationMs: number;
      event: "asset_cleanup";
      failed: number;
      leaseConflicts: number;
      lockAcquired: boolean;
      processed: number;
      status: "completed" | "disabled_skipped" | "failed" | "overlap_skipped";
    }
  | {
      event: "project_document_processing";
      operation:
        | "embedding_generation"
        | "embedding_lookup"
        | "embedding_orchestration"
        | "index_persistence"
        | "semantic_retrieval";
      outcome: "failed" | "usage_guard_skipped";
    }
  | {
      event: "conversation_summary_refresh";
      outcome: "degraded" | "failed";
      stage: "generation" | "orchestration" | "usage_reservation";
    };

export type OperationalEventRecord = OperationalEvent & { timestamp: string };
type OperationalEventWriter = (
  level: OperationalLogLevel,
  payload: OperationalEventRecord
) => Promise<void> | void;

let operationalEventWriter: OperationalEventWriter = (level, payload) => {
  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
};

/**
 * Writes a deliberately narrow, structured operational event. Payload types
 * contain counts/statuses only: never pass object keys, URLs, user IDs, raw
 * provider errors, database details, or credentials through this boundary.
 */
export function logOperationalEvent(
  level: OperationalLogLevel,
  event: OperationalEvent
) {
  try {
    const write = operationalEventWriter(level, {
      ...event,
      timestamp: new Date().toISOString(),
    });

    if (write) {
      void write.catch(() => {
        // Async writers are also best-effort and must not leak rejections.
      });
    }
  } catch {
    // Observability is best-effort and must never change application control flow.
  }
}

export function setOperationalEventLoggerForTests(writer: OperationalEventWriter) {
  const previousWriter = operationalEventWriter;
  operationalEventWriter = writer;

  return () => {
    operationalEventWriter = previousWriter;
  };
}
