CREATE TABLE "QaReadinessCandidate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requestId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "definition" JSONB NOT NULL,
  "definitionHash" TEXT NOT NULL,
  "initialDeployment" JSONB NOT NULL,
  "invalidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QaReadinessCandidate_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "QaRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QaReadinessCandidate_requestId_revision_key" ON "QaReadinessCandidate"("requestId", "revision");
CREATE TABLE "QaReadinessEvaluation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "candidateId" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QaReadinessEvaluation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "QaReadinessCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "QaReadinessEvaluation_candidateId_createdAt_idx" ON "QaReadinessEvaluation"("candidateId", "createdAt");
