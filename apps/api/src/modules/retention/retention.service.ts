import { env } from "../../config/env.js";
import { retentionRepository } from "./retention.repository.js";
import type {
  RetentionDrainResult,
  RetentionPurgeResult,
  RetentionRepository,
} from "./retention.types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINIMUM_USAGE_RETENTION_DAYS = 32;
export const DEFAULT_RETENTION_MAX_BATCHES = 20;

export interface RetentionPolicy {
  authTokenDays: number;
  unverifiedAccountDays: number;
  usageDays: number;
}

export function createRetentionService(repository: RetentionRepository) {
  async function purge(now: Date, policy: RetentionPolicy, batchSize = 100) {
    const cutoffs = validateAndBuildCutoffs(now, policy, batchSize);

    return repository.purgeExpiredData(now, cutoffs, batchSize);
  }

  async function drain(
    now: Date,
    policy: RetentionPolicy,
    batchSize = 100,
    maxBatches = DEFAULT_RETENTION_MAX_BATCHES
  ): Promise<RetentionDrainResult> {
    const cutoffs = validateAndBuildCutoffs(now, policy, batchSize);
    assertMaxBatches(maxBatches);

    const aggregate = emptyDrainResult();

    for (let batch = 0; batch < maxBatches; batch += 1) {
      const result = await repository.purgeExpiredData(now, cutoffs, batchSize);

      if (!result.lockAcquired) {
        return {
          ...aggregate,
          lockAcquired: false,
          stopReason: "overlap",
        };
      }

      aggregate.batches += 1;
      aggregate.lockAcquired = true;
      aggregate.mayHaveMore = result.mayHaveMore;
      addRemovedCounts(aggregate, result);

      if (!result.mayHaveMore) {
        return {
          ...aggregate,
          stopReason: "drained",
        };
      }

      if (countRemoved(result) === 0) {
        return {
          ...aggregate,
          stopReason: "no_progress",
        };
      }
    }

    return {
      ...aggregate,
      stopReason: aggregate.mayHaveMore ? "max_batches" : "drained",
    };
  }

  return { drain, purge };
}

export function parseRetentionPolicy(environment: NodeJS.ProcessEnv): RetentionPolicy {
  return {
    authTokenDays: parseRetentionDays(environment.AUTH_TOKEN_RETENTION_DAYS, 7),
    unverifiedAccountDays: parseRetentionDays(
      environment.UNVERIFIED_ACCOUNT_RETENTION_DAYS,
      7
    ),
    usageDays: parseUsageRetentionDays(environment.USAGE_RECORD_RETENTION_DAYS, 32),
  };
}

export function getConfiguredRetentionPolicy(): RetentionPolicy {
  return {
    authTokenDays: env.authTokenRetentionDays,
    unverifiedAccountDays: env.unverifiedAccountRetentionDays,
    usageDays: env.usageRecordRetentionDays,
  };
}

function parseRetentionDays(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;

  const parsed = Number(value);
  assertRetentionDays("retention days", parsed);
  return parsed;
}

function parseUsageRetentionDays(value: string | undefined, fallback: number) {
  const parsed = parseRetentionDays(value, fallback);
  assertUsageRetentionDays(parsed);
  return parsed;
}

function assertUsageRetentionDays(value: number) {
  assertRetentionDays("usageDays", value);
  if (value < MINIMUM_USAGE_RETENTION_DAYS) {
    throw new Error(
      `usageDays must be at least ${MINIMUM_USAGE_RETENTION_DAYS} so the calendar-month AI guard remains complete.`
    );
  }
}

function assertRetentionDays(name: string, value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new Error(`${name} must be an integer from 1 to 3650.`);
  }
}

function assertBatchSize(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new Error("retention cleanup batch size must be an integer from 1 to 1000.");
  }
}

function assertMaxBatches(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("retention cleanup max batches must be an integer from 1 to 100.");
  }
}

function validateAndBuildCutoffs(
  now: Date,
  policy: RetentionPolicy,
  batchSize: number
) {
  assertRetentionDays("authTokenDays", policy.authTokenDays);
  assertRetentionDays("unverifiedAccountDays", policy.unverifiedAccountDays);
  assertUsageRetentionDays(policy.usageDays);
  assertBatchSize(batchSize);

  return {
    authTokensBefore: subtractDays(now, policy.authTokenDays),
    unverifiedAccountsBefore: subtractDays(now, policy.unverifiedAccountDays),
    usageBefore: subtractDays(now, policy.usageDays),
  };
}

function emptyDrainResult(): RetentionDrainResult {
  return {
    aiUsageLogs: 0,
    authEmailJobs: 0,
    batches: 0,
    emailVerificationTokens: 0,
    expiredAuthEmailJobsCancelled: 0,
    lockAcquired: false,
    mayHaveMore: false,
    passwordResetTokens: 0,
    sessions: 0,
    stopReason: "drained",
    unverifiedAccounts: 0,
    usageEvents: 0,
  };
}

function addRemovedCounts(
  aggregate: RetentionDrainResult,
  result: RetentionPurgeResult
) {
  aggregate.aiUsageLogs += result.aiUsageLogs;
  aggregate.authEmailJobs += result.authEmailJobs;
  aggregate.emailVerificationTokens += result.emailVerificationTokens;
  aggregate.expiredAuthEmailJobsCancelled += result.expiredAuthEmailJobsCancelled;
  aggregate.passwordResetTokens += result.passwordResetTokens;
  aggregate.sessions += result.sessions;
  aggregate.unverifiedAccounts += result.unverifiedAccounts;
  aggregate.usageEvents += result.usageEvents;
}

function countRemoved(result: RetentionPurgeResult) {
  return (
    result.aiUsageLogs +
    result.authEmailJobs +
    result.emailVerificationTokens +
    result.expiredAuthEmailJobsCancelled +
    result.passwordResetTokens +
    result.sessions +
    result.unverifiedAccounts +
    result.usageEvents
  );
}

function subtractDays(date: Date, days: number) {
  return new Date(date.getTime() - days * DAY_MS);
}

export const retentionService = createRetentionService(retentionRepository);
