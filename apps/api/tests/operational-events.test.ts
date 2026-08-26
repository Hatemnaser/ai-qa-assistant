import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  logOperationalEvent,
  setOperationalEventLoggerForTests,
  type OperationalEventRecord,
  type OperationalLogLevel,
} from "../src/lib/operational-events.ts";

describe("operational events", () => {
  it("emits structured count/status telemetry without private identifiers", () => {
    const records: Array<{
      level: OperationalLogLevel;
      payload: OperationalEventRecord;
    }> = [];
    const restore = setOperationalEventLoggerForTests((level, payload) => {
      records.push({ level, payload });
    });

    try {
      logOperationalEvent("warn", {
        cleanupCandidatesMayRemain: true,
        cleanupQueued: 3,
        deleted: 2,
        deletionBacklog: 8,
        dueDeletionBacklog: 1,
        durationMs: 47,
        event: "asset_cleanup",
        failed: 1,
        leaseConflicts: 0,
        lockAcquired: true,
        processed: 3,
        status: "completed",
      });
    } finally {
      restore();
    }

    assert.equal(records.length, 1);
    assert.equal(records[0]?.level, "warn");
    assert.match(records[0]?.payload.timestamp || "", /^\d{4}-\d{2}-\d{2}T/);
    const serialized = JSON.stringify(records[0]?.payload);
    assert.doesNotMatch(serialized, /objectKey|https:|userId|credential|secret/i);
  });

  it("never changes application control flow when the event writer fails", () => {
    const restore = setOperationalEventLoggerForTests(() => {
      throw new Error("logger unavailable");
    });

    try {
      assert.doesNotThrow(() => {
        logOperationalEvent("warn", {
          event: "conversation_summary_refresh",
          outcome: "failed",
          stage: "orchestration",
        });
      });
    } finally {
      restore();
    }
  });

  it("absorbs rejected async event writers", async () => {
    const restore = setOperationalEventLoggerForTests(async () => {
      throw new Error("async logger unavailable");
    });

    try {
      logOperationalEvent("warn", {
        event: "project_document_processing",
        operation: "semantic_retrieval",
        outcome: "failed",
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      restore();
    }
  });
});
