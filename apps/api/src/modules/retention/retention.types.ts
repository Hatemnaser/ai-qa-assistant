export interface RetentionCutoffs {
  authTokensBefore: Date;
  unverifiedAccountsBefore: Date;
  usageBefore: Date;
}

export interface RetentionPurgeResult {
  aiUsageLogs: number;
  authEmailJobs: number;
  expiredAuthEmailJobsCancelled: number;
  emailVerificationTokens: number;
  lockAcquired: boolean;
  mayHaveMore: boolean;
  passwordResetTokens: number;
  sessions: number;
  unverifiedAccounts: number;
  usageEvents: number;
}

export type RetentionDrainStopReason =
  | "drained"
  | "max_batches"
  | "no_progress"
  | "overlap";

export interface RetentionDrainResult extends RetentionPurgeResult {
  batches: number;
  stopReason: RetentionDrainStopReason;
}

export interface RetentionRepository {
  purgeExpiredData(
    now: Date,
    cutoffs: RetentionCutoffs,
    batchSize: number
  ): Promise<RetentionPurgeResult>;
}
