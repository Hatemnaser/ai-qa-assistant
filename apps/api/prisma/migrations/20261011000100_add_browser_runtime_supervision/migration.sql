CREATE TABLE "QaBrowserRuntime" (
  "runtimeId" TEXT NOT NULL PRIMARY KEY,
  "executionId" TEXT NOT NULL UNIQUE,
  "claimId" TEXT NOT NULL,
  "imageDigest" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'LIVE',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stopRequestedAt" TIMESTAMP(3),
  "exitObservedAt" TIMESTAMP(3),
  CONSTRAINT "QaBrowserRuntime_execution_fkey" FOREIGN KEY ("executionId") REFERENCES "QaExecutionJob"("id") ON DELETE CASCADE,
  CONSTRAINT "QaBrowserRuntime_state_check" CHECK ("state" IN ('LIVE','STOP_REQUESTED','STOP_UNCONFIRMED','STOP_CONFIRMED')),
  CONSTRAINT "QaBrowserRuntime_digest_check" CHECK ("imageDigest" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "QaBrowserRuntime_stop_check" CHECK (
    ("state" = 'LIVE' AND "stopRequestedAt" IS NULL AND "exitObservedAt" IS NULL)
    OR ("state" IN ('STOP_REQUESTED','STOP_UNCONFIRMED') AND "stopRequestedAt" IS NOT NULL AND "exitObservedAt" IS NULL)
    OR ("state" = 'STOP_CONFIRMED' AND "stopRequestedAt" IS NOT NULL AND "exitObservedAt" IS NOT NULL AND "exitObservedAt" >= "stopRequestedAt")
  )
);
CREATE INDEX "QaBrowserRuntime_state_lastSeenAt_idx" ON "QaBrowserRuntime"("state","lastSeenAt");
