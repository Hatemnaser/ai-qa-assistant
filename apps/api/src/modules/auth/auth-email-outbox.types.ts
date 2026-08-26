export type AuthEmailJobKind = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

export interface ClaimedAuthEmailJob {
  attempts: number;
  email: string;
  encryptedPayload: string;
  expiresAt: Date;
  id: string;
  kind: AuthEmailJobKind;
  lockedAt: Date;
  tokenExpiresAt: Date;
  tokenUsedAt: Date | null;
  userEmailVerifiedAt: Date | null;
  userId: string;
}

export interface CancelExpiredAuthEmailJobsInput {
  limit: number;
  now: Date;
}

export interface ClaimNextAuthEmailJobInput {
  now: Date;
  staleBefore: Date;
}

export interface MarkClaimedAuthEmailJobInput {
  attempts: number;
  id: string;
  lockedAt: Date;
  now: Date;
}

export interface MarkFailedOrRetryAuthEmailJobInput extends MarkClaimedAuthEmailJobInput {
  maxAttempts: number;
  nextAttemptAt: Date;
}

export interface AuthEmailOutboxRepository {
  cancelExpired(input: CancelExpiredAuthEmailJobsInput): Promise<number>;
  claimNext(input: ClaimNextAuthEmailJobInput): Promise<ClaimedAuthEmailJob | null>;
  countPending(now: Date): Promise<number>;
  markCancelled(input: MarkClaimedAuthEmailJobInput): Promise<boolean>;
  markSent(input: MarkClaimedAuthEmailJobInput): Promise<boolean>;
  markFailedOrRetry(
    input: MarkFailedOrRetryAuthEmailJobInput
  ): Promise<"failed" | "retry" | null>;
}
