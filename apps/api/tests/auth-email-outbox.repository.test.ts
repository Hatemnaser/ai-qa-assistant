import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPrismaAuthEmailOutboxRepository } from "../src/modules/auth/auth-email-outbox.repository.ts";

const NOW = new Date("2026-08-19T10:00:00.000Z");
const LOCKED_AT = new Date("2026-08-19T09:59:00.000Z");

describe("auth email outbox repository", () => {
  it("cancels expired encrypted jobs in a bounded transaction", async () => {
    let findInput: Record<string, unknown> | undefined;
    let updateInput: Record<string, unknown> | undefined;
    const transaction = {
      authEmailJob: {
        async findMany(input: Record<string, unknown>) {
          findInput = input;
          return [{ id: "job-1" }, { id: "job-2" }];
        },
        async updateMany(input: Record<string, unknown>) {
          updateInput = input;
          return { count: 2 };
        },
      },
    };
    const repository = createPrismaAuthEmailOutboxRepository({
      async $transaction(callback: (tx: typeof transaction) => Promise<unknown>) {
        return callback(transaction);
      },
    } as never);

    const cancelled = await repository.cancelExpired({ limit: 25, now: NOW });

    assert.equal(cancelled, 2);
    assert.equal(findInput?.take, 25);
    assert.deepEqual(findInput?.where, {
      expiresAt: { lte: NOW },
      status: { in: ["PENDING", "PROCESSING"] },
    });
    assert.deepEqual(updateInput?.data, {
      encryptedPayload: null,
      lastErrorCode: null,
      lockedAt: null,
      nextAttemptAt: NOW,
      status: "CANCELLED",
    });
  });

  it("fences every claimed-job transition by attempt and lock timestamp", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const repository = createPrismaAuthEmailOutboxRepository({
      authEmailJob: {
        async updateMany(input: Record<string, unknown>) {
          updates.push(input);
          return { count: 1 };
        },
      },
    } as never);

    assert.equal(
      await repository.markSent({
        attempts: 3,
        id: "job-1",
        lockedAt: LOCKED_AT,
        now: NOW,
      }),
      true
    );
    assert.equal(
      await repository.markCancelled({
        attempts: 3,
        id: "job-1",
        lockedAt: LOCKED_AT,
        now: NOW,
      }),
      true
    );
    assert.equal(
      await repository.markFailedOrRetry({
        attempts: 3,
        id: "job-1",
        lockedAt: LOCKED_AT,
        maxAttempts: 5,
        nextAttemptAt: new Date("2026-08-19T10:01:00.000Z"),
        now: NOW,
      }),
      "retry"
    );

    for (const update of updates) {
      assert.deepEqual(update.where, {
        attempts: 3,
        id: "job-1",
        lockedAt: LOCKED_AT,
        status: "PROCESSING",
      });
    }
  });

  it("does not let a stale owner mutate a reclaimed job", async () => {
    const repository = createPrismaAuthEmailOutboxRepository({
      authEmailJob: {
        async updateMany() {
          return { count: 0 };
        },
      },
    } as never);

    assert.equal(
      await repository.markSent({
        attempts: 1,
        id: "job-1",
        lockedAt: LOCKED_AT,
        now: NOW,
      }),
      false
    );
    assert.equal(
      await repository.markFailedOrRetry({
        attempts: 1,
        id: "job-1",
        lockedAt: LOCKED_AT,
        maxAttempts: 5,
        nextAttemptAt: NOW,
        now: NOW,
      }),
      null
    );
  });
});
