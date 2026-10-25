CREATE TABLE "UsageSettlementReceipt" (
  "eventId" TEXT NOT NULL PRIMARY KEY,
  "attemptId" TEXT NOT NULL UNIQUE,
  "fingerprint" TEXT NOT NULL,
  "credits" INTEGER NOT NULL CHECK ("credits" >= 0),
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" TIMESTAMP(3),
  CONSTRAINT "UsageSettlementReceipt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "UsageEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UsageSettlementReceipt_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "UsageProviderAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "UsageSettlementReceipt_appliedAt_createdAt_idx" ON "UsageSettlementReceipt"("appliedAt", "createdAt");
CREATE INDEX "UsageProviderAttempt_startedAt_idx" ON "UsageProviderAttempt"("startedAt");
