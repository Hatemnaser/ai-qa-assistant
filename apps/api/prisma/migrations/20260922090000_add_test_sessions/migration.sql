ALTER TABLE "Chat" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CONVERSATION';
CREATE TABLE "TestSession" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "currentRequestId" TEXT,
  "pendingProposal" JSONB,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "TestSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TestSession_id_fkey" FOREIGN KEY ("id") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "QaRequest" ADD COLUMN "testSessionId" TEXT;
ALTER TABLE "QaRequest" ADD CONSTRAINT "QaRequest_testSessionId_fkey" FOREIGN KEY ("testSessionId") REFERENCES "TestSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "QaRequest_testSessionId_createdAt_idx" ON "QaRequest"("testSessionId", "createdAt");
CREATE TABLE "TestSessionTurn" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "clientTurnId" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "model" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "TestSessionTurn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TestSessionTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TestSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TestSessionTurn_sessionId_clientTurnId_key" ON "TestSessionTurn"("sessionId", "clientTurnId");
CREATE INDEX "TestSessionTurn_status_availableAt_leaseExpiresAt_idx" ON "TestSessionTurn"("status", "availableAt", "leaseExpiresAt");
CREATE TABLE "TestSessionPreparation" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CHECKLIST',
  "runnerRegistrationId" TEXT,
  "profileKey" TEXT,
  "profileManifest" JSONB,
  "recipeId" TEXT,
  "operationId" TEXT,
  "errorCode" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TestSessionPreparation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TestSessionPreparation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TestSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TestSessionPreparation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "QaRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TestSessionPreparation_requestId_key" ON "TestSessionPreparation"("requestId");
CREATE UNIQUE INDEX "TestSessionPreparation_sessionId_proposalId_key" ON "TestSessionPreparation"("sessionId", "proposalId");
CREATE INDEX "TestSessionPreparation_status_updatedAt_idx" ON "TestSessionPreparation"("status", "updatedAt");
