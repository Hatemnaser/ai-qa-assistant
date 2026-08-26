import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAuthEmailPayloadContext,
  encryptAuthEmailPayload,
} from "../src/modules/auth/auth-email-outbox.crypto.ts";
import type {
  AuthEmailOutboxRepository,
  ClaimedAuthEmailJob,
} from "../src/modules/auth/auth-email-outbox.types.ts";
import { createAuthEmailOutboxWorker } from "../src/modules/auth/auth-email-outbox.worker.ts";
import { InMemoryAuthEmailService } from "../src/modules/auth/auth.email.ts";

const NOW = new Date("2026-08-19T10:00:00.000Z");
const SECRET = "test-email-outbox-secret-that-is-long-enough";

describe("auth email outbox worker", () => {
  it("delivers valid jobs and clears them through the repository", async () => {
    const job = createJob();
    const repository = createRepository([job]);
    const emailService = new InMemoryAuthEmailService();
    const worker = createAuthEmailOutboxWorker({
      batchSize: 2,
      emailService,
      encryptionSecret: SECRET,
      now: () => NOW,
      repository,
    });

    const summary = await worker.runOnce();

    assert.equal(summary.delivered, 1);
    assert.equal(repository.sent.length, 1);
    assert.equal(emailService.passwordResetEmails.length, 1);
    assert.equal(emailService.passwordResetEmails[0].to, "person@example.com");
  });

  it("cancels expired or already-used token jobs without sending", async () => {
    const repository = createRepository([
      createJob({ tokenUsedAt: NOW }),
    ]);
    const emailService = new InMemoryAuthEmailService();
    const worker = createAuthEmailOutboxWorker({
      emailService,
      encryptionSecret: SECRET,
      now: () => NOW,
      repository,
    });

    const summary = await worker.runOnce();

    assert.equal(summary.cancelled, 1);
    assert.deepEqual(repository.cancelled, ["job-1"]);
    assert.equal(emailService.passwordResetEmails.length, 0);
  });

  it("retries sanitized delivery failures and never stores provider text", async () => {
    const repository = createRepository([createJob()]);
    const worker = createAuthEmailOutboxWorker({
      emailService: {
        async sendEmailVerificationEmail() {},
        async sendPasswordResetEmail() {
          throw new Error("SMTP secret raw-token person@example.com");
        },
      },
      encryptionSecret: SECRET,
      maxAttempts: 5,
      now: () => NOW,
      repository,
    });

    const summary = await worker.runOnce();

    assert.equal(summary.retried, 1);
    assert.equal(repository.failures.length, 1);
    assert.equal(JSON.stringify(repository.failures).includes("SMTP secret"), false);
  });

  it("moves a final delivery failure to the terminal failed state", async () => {
    const repository = createRepository([createJob({ attempts: 5 })]);
    const worker = createAuthEmailOutboxWorker({
      emailService: {
        async sendEmailVerificationEmail() {},
        async sendPasswordResetEmail() {
          throw new Error("permanent provider failure");
        },
      },
      encryptionSecret: SECRET,
      maxAttempts: 5,
      now: () => NOW,
      repository,
    });

    const summary = await worker.runOnce();

    assert.equal(summary.failed, 1);
    assert.equal(summary.retried, 0);
  });

  it("cancels expired encrypted jobs during ordinary worker runs", async () => {
    const repository = createRepository([], { expiredToCancel: 2 });
    const worker = createAuthEmailOutboxWorker({
      encryptionSecret: SECRET,
      now: () => NOW,
      repository,
    });

    const summary = await worker.runOnce();

    assert.equal(summary.cancelled, 2);
    assert.equal(repository.expiredCleanupCalls, 1);
  });

  it("stops between jobs when shutdown is requested", async () => {
    let shouldStop = false;
    const repository = createRepository([
      createJob({ id: "job-1" }),
      createJob({ id: "job-2" }),
    ]);
    const emailService = new InMemoryAuthEmailService();
    const worker = createAuthEmailOutboxWorker({
      batchSize: 10,
      emailService: {
        async sendEmailVerificationEmail(message) {
          await emailService.sendEmailVerificationEmail(message);
          shouldStop = true;
        },
        async sendPasswordResetEmail(message) {
          await emailService.sendPasswordResetEmail(message);
          shouldStop = true;
        },
      },
      encryptionSecret: SECRET,
      now: () => NOW,
      repository,
    });

    const summary = await worker.runOnce({ shouldStop: () => shouldStop });

    assert.equal(summary.delivered, 1);
    assert.equal(emailService.passwordResetEmails.length, 1);
    assert.equal(repository.sent.length, 1);
  });
});

function createJob(overrides: Partial<ClaimedAuthEmailJob> = {}): ClaimedAuthEmailJob {
  const base = {
    attempts: 1,
    email: "person@example.com",
    encryptedPayload: "",
    expiresAt: new Date("2026-08-19T11:00:00.000Z"),
    id: "job-1",
    kind: "PASSWORD_RESET" as const,
    lockedAt: NOW,
    tokenExpiresAt: new Date("2026-08-19T11:00:00.000Z"),
    tokenUsedAt: null,
    userEmailVerifiedAt: null,
    userId: "user-1",
  };
  const merged = { ...base, ...overrides };
  merged.encryptedPayload = encryptAuthEmailPayload(
    {
      expiresAt: merged.expiresAt.toISOString(),
      url: "https://oddpath.example/#/reset-password?token=raw-secret",
    },
    {
      context: buildAuthEmailPayloadContext({
        jobId: merged.id,
        kind: merged.kind,
        userId: merged.userId,
      }),
      secret: SECRET,
    }
  );
  return merged;
}

function createRepository(
  initialJobs: ClaimedAuthEmailJob[],
  options: { expiredToCancel?: number } = {}
) {
  const jobs = [...initialJobs];
  const repository = {
    cancelled: [] as string[],
    expiredCleanupCalls: 0,
    failures: [] as Array<Record<string, unknown>>,
    sent: [] as string[],
    async cancelExpired() {
      repository.expiredCleanupCalls += 1;
      return options.expiredToCancel ?? 0;
    },
    async claimNext() {
      return jobs.shift() ?? null;
    },
    async countPending() {
      return jobs.length;
    },
    async markCancelled(input: { id: string }) {
      repository.cancelled.push(input.id);
      return true;
    },
    async markSent(input: { id: string }) {
      repository.sent.push(input.id);
      return true;
    },
    async markFailedOrRetry(input: {
      attempts: number;
      id: string;
      maxAttempts: number;
      nextAttemptAt: Date;
      now: Date;
    }) {
      repository.failures.push({ ...input });
      return input.attempts >= input.maxAttempts ? "failed" as const : "retry" as const;
    },
  } satisfies AuthEmailOutboxRepository & {
    cancelled: string[];
    expiredCleanupCalls: number;
    failures: Array<Record<string, unknown>>;
    sent: string[];
  };

  return repository;
}
