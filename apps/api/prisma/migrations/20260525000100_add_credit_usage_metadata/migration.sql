-- Extend usage events from message counts into credit-based accounting.
ALTER TABLE "UsageEvent" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE "UsageEvent" ALTER COLUMN "status" SET DEFAULT 'reserved';
ALTER TABLE "UsageEvent" ADD COLUMN "provider" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "model" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "mode" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "workflowIntent" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "workflowSource" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "modelRoutingSource" TEXT;
ALTER TABLE "UsageEvent" ADD COLUMN "creditsReserved" INTEGER;
ALTER TABLE "UsageEvent" ADD COLUMN "creditsUsed" INTEGER;
ALTER TABLE "UsageEvent" ADD COLUMN "estimatedPromptTokens" INTEGER;
ALTER TABLE "UsageEvent" ADD COLUMN "estimatedOutputTokens" INTEGER;
ALTER TABLE "UsageEvent" ADD COLUMN "estimatedTotalTokens" INTEGER;
ALTER TABLE "UsageEvent" ADD COLUMN "promptTokens" INTEGER;
ALTER TABLE "UsageEvent" ADD COLUMN "outputTokens" INTEGER;
ALTER TABLE "UsageEvent" ADD COLUMN "totalTokens" INTEGER;
ALTER TABLE "UsageEvent" ADD COLUMN "attachmentCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "imageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageEvent" ADD COLUMN "fileCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "UsageEvent_model_createdAt_idx" ON "UsageEvent"("model", "createdAt");
