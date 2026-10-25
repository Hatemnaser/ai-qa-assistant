CREATE TABLE "QaTarget" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "label" TEXT NOT NULL,
  "currentRevision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QaTarget_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QaTarget_currentRevision_check" CHECK ("currentRevision" > 0)
);
CREATE TABLE "QaTargetRevision" (
  "id" TEXT NOT NULL, "targetId" TEXT NOT NULL, "revision" INTEGER NOT NULL,
  "definition" JSONB NOT NULL, "targetHash" TEXT NOT NULL,
  "authorityUserId" TEXT NOT NULL,
  "authorityAcceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QaTargetRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QaTargetRevision_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "QaTargetRevision_hash_check" CHECK ("targetHash" ~ '^[a-f0-9]{64}$')
);
CREATE TABLE "QaTargetVerification" (
  "id" TEXT NOT NULL, "revisionId" TEXT NOT NULL, "method" TEXT NOT NULL,
  "challengeHash" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3), "validUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QaTargetVerification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QaTargetVerification_method_check" CHECK ("method" IN ('DNS_TXT', 'HTTPS_FILE')),
  CONSTRAINT "QaTargetVerification_hash_check" CHECK ("challengeHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "QaTargetVerification_dates_check" CHECK (
    ("verifiedAt" IS NULL AND "validUntil" IS NULL) OR
    ("verifiedAt" IS NOT NULL AND "validUntil" IS NOT NULL AND "validUntil" > "verifiedAt")
  )
);
ALTER TABLE "QaExecutionAuthorization"
  ADD COLUMN "protocolVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "requestVersion" INTEGER,
  ADD COLUMN "targetRevisionId" TEXT,
  ADD COLUMN "targetHash" TEXT,
  ADD COLUMN "verificationId" TEXT,
  ADD COLUMN "bindingHash" TEXT,
  ADD COLUMN "binding" JSONB,
  ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "QaExecutionAuthorization" ADD CONSTRAINT "QaExecutionAuthorization_v2_binding_check" CHECK (
  "protocolVersion" = 1 OR (
    "protocolVersion" = 2 AND "requestVersion" IS NOT NULL AND "requestVersion" > 0 AND "targetRevisionId" IS NOT NULL
    AND "targetHash" IS NOT NULL AND "targetHash" ~ '^[a-f0-9]{64}$' AND "verificationId" IS NOT NULL
    AND "bindingHash" IS NOT NULL AND "bindingHash" ~ '^[a-f0-9]{64}$' AND "binding" IS NOT NULL
    AND "expiresAt" IS NOT NULL AND "expiresAt" > "approvedAt"
  )
);
CREATE INDEX "QaTarget_projectId_idx" ON "QaTarget"("projectId");
CREATE UNIQUE INDEX "QaTargetRevision_targetId_revision_key" ON "QaTargetRevision"("targetId", "revision");
CREATE INDEX "QaTargetVerification_revisionId_validUntil_idx" ON "QaTargetVerification"("revisionId", "validUntil");
CREATE INDEX "QaExecutionAuthorization_targetRevisionId_idx" ON "QaExecutionAuthorization"("targetRevisionId");
CREATE INDEX "QaExecutionAuthorization_verificationId_idx" ON "QaExecutionAuthorization"("verificationId");
ALTER TABLE "QaTarget" ADD CONSTRAINT "QaTarget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QaTargetRevision" ADD CONSTRAINT "QaTargetRevision_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "QaTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QaTargetVerification" ADD CONSTRAINT "QaTargetVerification_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QaTargetRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QaExecutionAuthorization" ADD CONSTRAINT "QaExecutionAuthorization_targetRevisionId_fkey" FOREIGN KEY ("targetRevisionId") REFERENCES "QaTargetRevision"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "QaExecutionAuthorization" ADD CONSTRAINT "QaExecutionAuthorization_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "QaTargetVerification"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
