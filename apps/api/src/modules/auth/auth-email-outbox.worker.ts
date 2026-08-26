import { env } from "../../config/env.js";
import { logAuthEmailDeliveryFailed } from "../../lib/security-events.js";
import {
  buildAuthEmailPayloadContext,
  decryptAuthEmailPayload,
} from "./auth-email-outbox.crypto.js";
import { authEmailOutboxRepository } from "./auth-email-outbox.repository.js";
import type {
  AuthEmailOutboxRepository,
  ClaimedAuthEmailJob,
} from "./auth-email-outbox.types.js";
import { authEmailService, type AuthEmailService } from "./auth.email.js";

const STALE_CLAIM_MS = 5 * 60 * 1000;
const BASE_RETRY_MS = 30_000;
const MAX_RETRY_MS = 15 * 60 * 1000;

export interface AuthEmailOutboxWorkerDependencies {
  batchSize?: number;
  emailService?: AuthEmailService;
  encryptionSecret?: string;
  maxAttempts?: number;
  now?: () => Date;
  repository?: AuthEmailOutboxRepository;
}

export function createAuthEmailOutboxWorker({
  batchSize = env.emailOutboxBatchSize,
  emailService = authEmailService,
  encryptionSecret = env.emailOutboxEncryptionSecret,
  maxAttempts = env.emailOutboxMaxAttempts,
  now = () => new Date(),
  repository = authEmailOutboxRepository,
}: AuthEmailOutboxWorkerDependencies = {}) {
  async function runOnce(input: { shouldStop?: () => boolean } = {}) {
    const summary = {
      cancelled: 0,
      delivered: 0,
      failed: 0,
      pending: 0,
      retried: 0,
    };

    if (input.shouldStop?.()) return summary;

    const cleanupTime = now();
    summary.cancelled += await repository.cancelExpired({
      limit: batchSize,
      now: cleanupTime,
    });

    for (let index = 0; index < batchSize; index += 1) {
      if (input.shouldStop?.()) break;

      const claimedAt = now();
      const job = await repository.claimNext({
        now: claimedAt,
        staleBefore: new Date(claimedAt.getTime() - STALE_CLAIM_MS),
      });

      if (!job) break;

      if (!isDeliverable(job, claimedAt)) {
        const cancelled = await repository.markCancelled({
          attempts: job.attempts,
          id: job.id,
          lockedAt: job.lockedAt,
          now: claimedAt,
        });
        if (cancelled) summary.cancelled += 1;
        continue;
      }

      try {
        const payload = decryptAuthEmailPayload(job.encryptedPayload, {
          context: buildAuthEmailPayloadContext({
            jobId: job.id,
            kind: job.kind,
            userId: job.userId,
          }),
          secret: encryptionSecret,
        });

        if (job.kind === "EMAIL_VERIFICATION") {
          await emailService.sendEmailVerificationEmail({
            expiresAt: new Date(payload.expiresAt),
            to: job.email,
            verificationUrl: payload.url,
          });
        } else {
          await emailService.sendPasswordResetEmail({
            expiresAt: new Date(payload.expiresAt),
            resetUrl: payload.url,
            to: job.email,
          });
        }

        await repository.markSent({
          attempts: job.attempts,
          id: job.id,
          lockedAt: job.lockedAt,
          now: now(),
        });
        summary.delivered += 1;
      } catch {
        const failureTime = now();
        const result = await repository.markFailedOrRetry({
          attempts: job.attempts,
          id: job.id,
          lockedAt: job.lockedAt,
          maxAttempts,
          nextAttemptAt: new Date(
            failureTime.getTime() + calculateRetryDelayMs(job.attempts)
          ),
          now: failureTime,
        });

        logAuthEmailDeliveryFailed({
          operation: job.kind === "EMAIL_VERIFICATION"
            ? "email_verification"
            : "password_reset",
        });
        if (result) {
          summary[result === "failed" ? "failed" : "retried"] += 1;
        }
      }
    }

    summary.pending = await repository.countPending(now());
    return summary;
  }

  return { runOnce };
}

export function startAuthEmailOutboxLoop(input: {
  intervalMs?: number;
  logger?: Pick<Console, "error" | "info" | "warn">;
  worker?: ReturnType<typeof createAuthEmailOutboxWorker>;
} = {}) {
  const intervalMs = input.intervalMs ?? env.emailOutboxPollIntervalMs;
  const logger = input.logger ?? console;
  const worker = input.worker ?? createAuthEmailOutboxWorker();
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(run, intervalMs);
    timer.unref?.();
  };

  const run = () => {
    if (stopped || inFlight) return;
    inFlight = worker.runOnce({ shouldStop: () => stopped })
      .then((summary) => {
        if (summary.delivered || summary.failed || summary.retried || summary.cancelled) {
          logger.info(JSON.stringify({ event: "auth_email_outbox_run", ...summary }));
        }
        if (summary.pending >= env.emailOutboxBatchSize * 5) {
          logger.warn(JSON.stringify({
            event: "auth_email_outbox_backlog",
            pending: summary.pending,
          }));
        }
      })
      .catch(() => {
        logger.error(JSON.stringify({ event: "auth_email_outbox_run_failed" }));
      })
      .finally(() => {
        inFlight = undefined;
        schedule();
      });
  };

  run();

  return async function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    await inFlight;
  };
}

function isDeliverable(job: ClaimedAuthEmailJob, now: Date) {
  if (job.expiresAt <= now || job.tokenExpiresAt <= now || job.tokenUsedAt) return false;
  if (job.kind === "EMAIL_VERIFICATION" && job.userEmailVerifiedAt) return false;
  return true;
}

function calculateRetryDelayMs(attempts: number) {
  return Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.max(0, attempts - 1));
}
