ALTER TABLE "UsageEvent" ADD COLUMN "fixedCredits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "expiresAt" TIMESTAMP(3), ADD COLUMN "settledAt" TIMESTAMP(3),
  ADD COLUMN "reservationPolicy" JSONB;
CREATE TABLE "UsageProviderAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY, "eventId" TEXT NOT NULL, "ordinal" INTEGER NOT NULL,
  "kind" TEXT NOT NULL, "provider" TEXT, "model" TEXT,
  "status" TEXT NOT NULL DEFAULT 'started', "creditsReserved" INTEGER NOT NULL,
  "creditsUsed" INTEGER, "promptTokens" INTEGER, "outputTokens" INTEGER, "totalTokens" INTEGER,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "settledAt" TIMESTAMP(3),
  CONSTRAINT "UsageProviderAttempt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "UsageEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UsageProviderAttempt_credits_check" CHECK ("creditsReserved">=0 AND ("creditsUsed" IS NULL OR "creditsUsed">=0))
);
CREATE UNIQUE INDEX "UsageProviderAttempt_eventId_ordinal_key" ON "UsageProviderAttempt"("eventId","ordinal");
CREATE INDEX "UsageProviderAttempt_eventId_status_idx" ON "UsageProviderAttempt"("eventId","status");
CREATE TABLE "QaBrowserDailyUsage" (
  "ownerId" TEXT NOT NULL, "day" DATE NOT NULL, "count" INTEGER NOT NULL,
  PRIMARY KEY ("ownerId","day"),
  CONSTRAINT "QaBrowserDailyUsage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QaBrowserDailyUsage_count_check" CHECK ("count">=0)
);
CREATE TABLE "QaBrowserReservation" (
  "executionId" TEXT NOT NULL PRIMARY KEY, "ownerId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'QUEUED', "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "queueExpiresAt" TIMESTAMP(3) NOT NULL, "grantedAt" TIMESTAMP(3), "releasedAt" TIMESTAMP(3),
  CONSTRAINT "QaBrowserReservation_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "QaExecutionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "QaBrowserReservation_state_queuedAt_idx" ON "QaBrowserReservation"("state","queuedAt");
CREATE INDEX "QaBrowserReservation_ownerId_state_idx" ON "QaBrowserReservation"("ownerId","state");
-- Preserve known usage and occupied capacity when upgrading an existing database.
INSERT INTO "QaBrowserDailyUsage" ("ownerId","day","count")
SELECT p."ownerId",j."createdAt"::date,count(*)::integer FROM "QaExecutionJob" j
JOIN "Project" p ON p."id"=j."projectId" WHERE j."protocolVersion"=2 GROUP BY p."ownerId",j."createdAt"::date;
INSERT INTO "QaBrowserReservation" ("executionId","ownerId","state","queuedAt","queueExpiresAt","grantedAt")
SELECT j."id",p."ownerId",CASE WHEN j."status"='QUEUED' AND r."runtimeId" IS NULL THEN 'QUEUED' ELSE 'ACTIVE' END,
 j."createdAt",LEAST(j."deadlineAt",j."createdAt"+INTERVAL '10 minutes'),
 CASE WHEN j."status"='QUEUED' AND r."runtimeId" IS NULL THEN NULL ELSE COALESCE(j."acceptedAt",j."createdAt") END
FROM "QaExecutionJob" j JOIN "Project" p ON p."id"=j."projectId"
LEFT JOIN "QaBrowserRuntime" r ON r."executionId"=j."id"
WHERE j."protocolVersion"=2 AND (j."status" IN ('QUEUED','CLAIMED','RUNNING') OR (r."runtimeId" IS NOT NULL AND r."state"<>'STOP_CONFIRMED'));
