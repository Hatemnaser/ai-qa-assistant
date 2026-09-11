import { randomUUID } from "node:crypto";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { qaProcessingRepository } from "./qa-processing.repository.js";
import { QaRecipeOutputError } from "./qa-recipe-output.js";
import type { QaGenerationKind } from "../../generated/prisma/client.js";
import type {
  ClaimedQaProcessingJob,
  QaProcessingHandlers,
  QaProcessingRepository,
} from "./qa-processing.types.js";

const TERMINAL_CODES = new Set([
  "AI_DISABLED",
  "AI_MODEL_INVALID",
  "AI_PROVIDER_INVALID",
  "MISSING_API_KEY",
  "QA_ARTIFACT_INVALID",
  "QA_ARTIFACT_MISSING",
  "QA_ARTIFACT_NOT_FOUND",
  "QA_CONTEXT_MISSING",
  "QA_REQUEST_NOT_FOUND",
  "USAGE_LIMIT_REACHED",
  "USAGE_RESERVATION_DENIED",
]);

export interface QaProcessingWorkerDependencies {
  handlers: QaProcessingHandlers;
  leaseMs?: number;
  logger?: Pick<Console, "warn">;
  maxAttempts?: number;
  now?: () => Date;
  providerTimeoutMs?: number;
  random?: () => number;
  repository?: QaProcessingRepository;
}

export function createQaProcessingWorker({
  handlers,
  leaseMs = env.qaProcessingLeaseMs,
  logger = console,
  maxAttempts = env.qaProcessingMaxAttempts,
  now = () => new Date(),
  providerTimeoutMs = env.qaProcessingTimeoutMs,
  random = Math.random,
  repository = qaProcessingRepository,
}: QaProcessingWorkerDependencies) {
  async function runOnce(input: { concurrency?: number; shouldStop?: () => boolean } = {}) {
    const concurrency = input.concurrency ?? env.qaProcessingConcurrency;
    const kinds = Object.keys(handlers) as QaGenerationKind[];
    const jobs: ClaimedQaProcessingJob[] = [];
    if (kinds.length === 0) {
      return { failed: 0, pending: 0, processed: 0, processing: 0, retried: 0, stale: 0 };
    }
    for (let index = 0; index < concurrency; index += 1) {
      if (input.shouldStop?.()) break;
      const claimedAt = now();
      const job = await repository.claimNext({
        kinds,
        leaseExpiresAt: new Date(claimedAt.getTime() + leaseMs),
        leaseToken: randomUUID(),
        now: claimedAt,
      });
      if (!job) break;
      jobs.push(job);
    }

    const results = await Promise.all(jobs.map((job) => processJob(job)));
    const queue = await repository.countQueue(now());
    return {
      failed: results.filter((result) => result === "failed").length,
      processed: results.filter((result) => result === "processed").length,
      retried: results.filter((result) => result === "retried").length,
      ...queue,
    };
  }

  async function processJob(job: ClaimedQaProcessingJob) {
    const handler = handlers[job.kind];
    if (!handler) {
      await failTerminal(job, "QA_PROCESSING_HANDLER_MISSING");
      return "failed" as const;
    }

    const controller = new AbortController();
    let rejectTimeout: ((error: Error) => void) | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const timeout = setTimeout(() => {
      controller.abort();
      rejectTimeout?.(new AppError("QA processing timed out.", 504, "AI_TIMEOUT"));
    }, providerTimeoutMs);
    timeout.unref?.();
    try {
      await Promise.race([handler.run(job, controller.signal), timeoutPromise]);
      return "processed" as const;
    } catch (error) {
      const errorCode = safeErrorCode(error, controller.signal.aborted);
      if (error instanceof QaRecipeOutputError) {
        logRecipeOutputFailure(logger, job, error, errorCode);
      }
      if (job.attempts < maxAttempts && isRetryable(errorCode)) {
        const retried = await repository.scheduleRetry({
          availableAt: new Date(now().getTime() + retryDelayMs(job.attempts, random)),
          errorCode,
          id: job.id,
          leaseToken: job.leaseToken,
        });
        if (retried) return "retried" as const;
      }
      await failTerminal(job, errorCode);
      return "failed" as const;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function failTerminal(job: ClaimedQaProcessingJob, errorCode: string) {
    const handler = handlers[job.kind];
    try {
      if (handler) await handler.fail(job, errorCode);
      else {
        await repository.markTerminal({
          errorCode,
          id: job.id,
          leaseToken: job.leaseToken,
        });
      }
    } catch (error) {
      if (error instanceof AppError && error.code === "QA_PROCESSING_LEASE_LOST") return;
      throw error;
    }
  }

  return { runOnce };
}

export function startQaProcessingLoop(input: {
  handlers: QaProcessingHandlers;
  intervalMs?: number;
  logger?: Pick<Console, "error" | "info" | "warn">;
  worker?: ReturnType<typeof createQaProcessingWorker>;
} ) {
  const logger = input.logger ?? console;
  const worker = input.worker ?? createQaProcessingWorker({ handlers: input.handlers, logger });
  const intervalMs = input.intervalMs ?? env.qaProcessingPollIntervalMs;
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(run, intervalMs);
    timer.unref?.();
  };
  const run = () => {
    if (stopped || inFlight) return;
    inFlight = worker.runOnce({ shouldStop: () => stopped })
      .then((summary) => {
        if (summary.processed || summary.retried || summary.failed) {
          logger.info(JSON.stringify({ event: "qa_processing", ...summary }));
        }
        if (summary.stale || summary.pending >= 10) {
          logger.warn(JSON.stringify({ event: "qa_processing_queue", ...summary }));
        }
      })
      .catch(() => logger.error(JSON.stringify({ event: "qa_processing_failed" })))
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

function retryDelayMs(attempts: number, random: () => number) {
  const base = attempts <= 1 ? 5_000 : 30_000;
  return base + Math.floor(base * 0.2 * random());
}

function isRetryable(errorCode: string) {
  return !TERMINAL_CODES.has(errorCode);
}

function safeErrorCode(error: unknown, aborted: boolean) {
  if (aborted) return "AI_TIMEOUT";
  if (error instanceof AppError && /^[A-Z][A-Z0-9_-]{0,63}$/u.test(error.code)) return error.code;
  return "QA_PROCESSING_FAILED";
}

function logRecipeOutputFailure(
  logger: Pick<Console, "warn">,
  job: ClaimedQaProcessingJob,
  error: QaRecipeOutputError,
  errorCode: string
) {
  try {
    logger.warn(JSON.stringify({
      event: "qa_processing_output_invalid",
      operationId: job.id,
      kind: job.kind,
      attempt: job.attempts,
      errorCode,
      diagnostics: {
        stage: error.diagnostics.stage,
        issues: error.diagnostics.issues.map(({ code, path }) => ({ code, path })),
      },
    }));
  } catch {
    // Diagnostic failures must not prevent retry or terminal lease handling.
  }
}
