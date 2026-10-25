-- Preserve existing receipts while allowing trusted reconciliation of an earlier
-- attempt. An attempt still has exactly one immutable consumption receipt.
ALTER TABLE "UsageSettlementReceipt" DROP CONSTRAINT "UsageSettlementReceipt_pkey";
ALTER TABLE "UsageSettlementReceipt" DROP CONSTRAINT "UsageSettlementReceipt_attemptId_key";
ALTER TABLE "UsageSettlementReceipt" ADD CONSTRAINT "UsageSettlementReceipt_pkey" PRIMARY KEY ("attemptId");
CREATE INDEX "UsageSettlementReceipt_eventId_idx" ON "UsageSettlementReceipt"("eventId");

-- Old mixed-outcome events must not keep estimates in their verified debit.
-- Router charges retain the existing fixed-fee policy; only unresolved
-- generation attempts make consumption unconfirmed.
UPDATE "UsageEvent" e SET "status"='partial',
  "creditsUsed"=e."fixedCredits"+COALESCE((SELECT SUM(a."creditsUsed") FROM "UsageProviderAttempt" a WHERE a."eventId"=e."id"),0)
WHERE e."reservationPolicy" IS NOT NULL AND e."status"='completed'
  AND EXISTS (SELECT 1 FROM "UsageSettlementReceipt" r WHERE r."eventId"=e."id")
  AND EXISTS (SELECT 1 FROM "UsageProviderAttempt" a WHERE a."eventId"=e."id" AND a."kind"='generation' AND a."creditsUsed" IS NULL);
