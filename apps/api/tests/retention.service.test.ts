import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createRetentionService,
  parseRetentionPolicy,
} from "../src/modules/retention/retention.service.ts";
import type {
  RetentionCutoffs,
  RetentionPurgeResult,
  RetentionRepository,
} from "../src/modules/retention/retention.types.ts";

describe("retention service", () => {
  it("uses separate configurable cutoffs for auth tokens and usage records", async () => {
    let received: { batchSize: number; cutoffs: RetentionCutoffs; now: Date } | undefined;
    const repository: RetentionRepository = {
      async purgeExpiredData(now, cutoffs, batchSize) {
        received = { batchSize, cutoffs, now };
        return {
          aiUsageLogs: 2,
          authEmailJobs: 7,
          expiredAuthEmailJobsCancelled: 1,
          emailVerificationTokens: 3,
          lockAcquired: true,
          mayHaveMore: false,
          passwordResetTokens: 4,
          sessions: 5,
          unverifiedAccounts: 1,
          usageEvents: 6,
        };
      },
    };
    const now = new Date("2026-08-12T12:00:00.000Z");

    const result = await createRetentionService(repository).purge(
      now,
      {
        authTokenDays: 7,
        unverifiedAccountDays: 10,
        usageDays: 32,
      },
      25
    );

    assert.equal(received?.now, now);
    assert.equal(received?.batchSize, 25);
    assert.equal(received?.cutoffs.authTokensBefore.toISOString(), "2026-08-05T12:00:00.000Z");
    assert.equal(received?.cutoffs.unverifiedAccountsBefore.toISOString(), "2026-08-02T12:00:00.000Z");
    assert.equal(received?.cutoffs.usageBefore.toISOString(), "2026-07-11T12:00:00.000Z");
    assert.deepEqual(result, {
      aiUsageLogs: 2,
      authEmailJobs: 7,
      expiredAuthEmailJobsCancelled: 1,
      emailVerificationTokens: 3,
      lockAcquired: true,
      mayHaveMore: false,
      passwordResetTokens: 4,
      sessions: 5,
      unverifiedAccounts: 1,
      usageEvents: 6,
    });
  });

  it("defaults to seven-day auth and unverified-account retention", () => {
    assert.deepEqual(parseRetentionPolicy({}), {
      authTokenDays: 7,
      unverifiedAccountDays: 7,
      usageDays: 32,
    });
  });

  it("drains bounded batches and aggregates removal telemetry", async () => {
    const batches = [
      purgeResult({ aiUsageLogs: 2, mayHaveMore: true, sessions: 3 }),
      purgeResult({ authEmailJobs: 4, mayHaveMore: true, usageEvents: 5 }),
      purgeResult({ emailVerificationTokens: 6, mayHaveMore: false }),
    ];
    let calls = 0;
    const repository: RetentionRepository = {
      async purgeExpiredData() {
        return batches[calls++]!;
      },
    };

    const result = await createRetentionService(repository).drain(
      new Date("2026-08-12T12:00:00.000Z"),
      { authTokenDays: 7, unverifiedAccountDays: 7, usageDays: 32 },
      25,
      5
    );

    assert.equal(calls, 3);
    assert.deepEqual(result, {
      aiUsageLogs: 2,
      authEmailJobs: 4,
      batches: 3,
      emailVerificationTokens: 6,
      expiredAuthEmailJobsCancelled: 0,
      lockAcquired: true,
      mayHaveMore: false,
      passwordResetTokens: 0,
      sessions: 3,
      stopReason: "drained",
      unverifiedAccounts: 0,
      usageEvents: 5,
    });
  });

  it("stops at the configured batch cap and reports remaining backlog", async () => {
    let calls = 0;
    const repository: RetentionRepository = {
      async purgeExpiredData() {
        calls += 1;
        return purgeResult({ mayHaveMore: true, usageEvents: 1 });
      },
    };

    const result = await createRetentionService(repository).drain(
      new Date("2026-08-12T12:00:00.000Z"),
      { authTokenDays: 7, unverifiedAccountDays: 7, usageDays: 32 },
      25,
      2
    );

    assert.equal(calls, 2);
    assert.equal(result.batches, 2);
    assert.equal(result.mayHaveMore, true);
    assert.equal(result.stopReason, "max_batches");
    assert.equal(result.usageEvents, 2);
  });

  it("stops without spinning when a full candidate batch makes no progress", async () => {
    let calls = 0;
    const repository: RetentionRepository = {
      async purgeExpiredData() {
        calls += 1;
        return purgeResult({ mayHaveMore: true });
      },
    };

    const result = await createRetentionService(repository).drain(
      new Date("2026-08-12T12:00:00.000Z"),
      { authTokenDays: 7, unverifiedAccountDays: 7, usageDays: 32 },
      25,
      20
    );

    assert.equal(calls, 1);
    assert.equal(result.stopReason, "no_progress");
    assert.equal(result.mayHaveMore, true);
  });

  it("rejects unsafe or unbounded retention values", async () => {
    assert.throws(
      () => parseRetentionPolicy({ USAGE_RECORD_RETENTION_DAYS: "0" }),
      /integer from 1 to 3650/
    );
    assert.throws(
      () => parseRetentionPolicy({ USAGE_RECORD_RETENTION_DAYS: "31" }),
      /must be at least 32/
    );
    assert.throws(
      () => parseRetentionPolicy({ AUTH_TOKEN_RETENTION_DAYS: "forever" }),
      /integer from 1 to 3650/
    );
    assert.throws(
      () => parseRetentionPolicy({ UNVERIFIED_ACCOUNT_RETENTION_DAYS: "3651" }),
      /integer from 1 to 3650/
    );

    const repository = {
      async purgeExpiredData() {
        throw new Error("must not reach repository");
      },
    } as RetentionRepository;
    await assert.rejects(
      () =>
        createRetentionService(repository).purge(
          new Date(),
          { authTokenDays: 7, unverifiedAccountDays: 7, usageDays: 32 },
          1_001
        ),
      /batch size must be an integer from 1 to 1000/
    );
    await assert.rejects(
      () =>
        createRetentionService(repository).drain(
          new Date(),
          { authTokenDays: 7, unverifiedAccountDays: 7, usageDays: 32 },
          100,
          101
        ),
      /max batches must be an integer from 1 to 100/
    );
  });
});

function purgeResult(
  overrides: Partial<RetentionPurgeResult> = {}
): RetentionPurgeResult {
  return {
    aiUsageLogs: 0,
    authEmailJobs: 0,
    emailVerificationTokens: 0,
    expiredAuthEmailJobsCancelled: 0,
    lockAcquired: true,
    mayHaveMore: false,
    passwordResetTokens: 0,
    sessions: 0,
    unverifiedAccounts: 0,
    usageEvents: 0,
    ...overrides,
  };
}
