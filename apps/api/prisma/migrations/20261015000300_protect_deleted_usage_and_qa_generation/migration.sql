-- Anonymous financial exposure outlives a deleted account only until its
-- bounded quota/reconciliation deadline. No account identifier is retained.
ALTER TABLE "UsageEvent" ADD COLUMN "anonymousUntil" TIMESTAMP(3);
CREATE INDEX "UsageEvent_anonymousUntil_idx" ON "UsageEvent"("anonymousUntil");

-- Persist authority before generation, including across process/lease loss.
ALTER TABLE "QaGenerationExecution" ADD COLUMN "providerStartedAt" TIMESTAMP(3);
-- Old claimed/retried work may already have called a provider. Drain old
-- workers before upgrading; never silently replay these ambiguous attempts.
UPDATE "QaGenerationExecution" SET "providerStartedAt"=COALESCE("updatedAt","createdAt")
WHERE "status" IN ('PROCESSING','PENDING') AND "attempts">0;
