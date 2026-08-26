import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getRetentionCleanupOutcome } from "../src/modules/retention/retention.cleanup-outcome.ts";

describe("retention cleanup scheduler outcome", () => {
  it("returns a scheduler-visible failure when bounded work remains", () => {
    assert.deepEqual(
      getRetentionCleanupOutcome({ batches: 20, stopReason: "max_batches" }),
      { exitCode: 1, level: "error", status: "failed" }
    );
    assert.deepEqual(
      getRetentionCleanupOutcome({ batches: 1, stopReason: "no_progress" }),
      { exitCode: 1, level: "error", status: "failed" }
    );
  });

  it("allows a fully drained run or an immediate overlap skip to succeed", () => {
    assert.deepEqual(
      getRetentionCleanupOutcome({ batches: 3, stopReason: "drained" }),
      { exitCode: 0, level: "info", status: "completed" }
    );
    assert.deepEqual(
      getRetentionCleanupOutcome({ batches: 0, stopReason: "overlap" }),
      { exitCode: 0, level: "warn", status: "overlap_skipped" }
    );
  });

  it("fails if overlap interrupts a run that had already found backlog", () => {
    assert.deepEqual(
      getRetentionCleanupOutcome({ batches: 2, stopReason: "overlap" }),
      { exitCode: 1, level: "error", status: "failed" }
    );
  });
});
