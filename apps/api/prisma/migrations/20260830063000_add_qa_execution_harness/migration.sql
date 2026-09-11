-- Extend the durable QA processing queue for execution-recipe work.
ALTER TYPE "QaGenerationKind" ADD VALUE 'EXECUTION_RECIPE_GENERATION';
ALTER TYPE "QaGenerationKind" ADD VALUE 'EXECUTION_RECIPE_REVIEW';

CREATE TYPE "QaExecutionJobStatus" AS ENUM (
  'QUEUED',
  'CLAIMED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE "ExternalIdempotencyState" AS ENUM (
  'PENDING',
  'COMPLETED',
  'LEGACY_AMBIGUOUS'
);

ALTER TABLE "QaRun"
  ADD COLUMN "executionRecipeId" TEXT;

ALTER TABLE "QaGenerationExecution"
  ADD COLUMN "recipeId" TEXT,
  ADD COLUMN "profileManifest" JSONB,
  ADD COLUMN "profileManifestHash" TEXT;

ALTER TABLE "ExternalIdempotencyRecord"
  ADD COLUMN "resourceType" TEXT,
  ADD COLUMN "state" "ExternalIdempotencyState" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "protocolVersion" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "expiresAt" TIMESTAMP(3);

UPDATE "ExternalIdempotencyRecord"
SET
  "state" = CASE
    WHEN "responseStatus" IS NULL THEN 'LEGACY_AMBIGUOUS'::"ExternalIdempotencyState"
    ELSE 'COMPLETED'::"ExternalIdempotencyState"
  END,
  "protocolVersion" = 1,
  "completedAt" = CASE WHEN "responseStatus" IS NULL THEN NULL ELSE "updatedAt" END,
  "expiresAt" = CASE
    WHEN "responseStatus" IS NULL THEN CURRENT_TIMESTAMP + INTERVAL '30 days'
    ELSE "createdAt" + INTERVAL '30 days'
  END;

CREATE TABLE "QaExecutionRecipe" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "origin" "QaArtifactOrigin" NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "executorKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "canonicalJson" JSONB NOT NULL,
  "recipeHash" TEXT NOT NULL,
  "profileManifest" JSONB,
  "profileManifestHash" TEXT,
  "supersedesRecipeId" TEXT,
  "createdByUserId" TEXT,
  "connectionTokenId" TEXT,
  "transport" "QaTransport" NOT NULL,
  "provider" TEXT,
  "model" TEXT,
  "lockedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QaExecutionRecipe_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QaExecutionRecipeItem" (
  "id" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "checklistItemId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "steps" JSONB NOT NULL,
  "recipeHash" TEXT NOT NULL,
  CONSTRAINT "QaExecutionRecipeItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QaExecutionRecipeAssessment" (
  "id" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "status" "QaChecklistAssessmentStatus" NOT NULL DEFAULT 'PENDING',
  "summary" TEXT,
  "suggestions" JSONB NOT NULL,
  "provider" TEXT,
  "model" TEXT,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "QaExecutionRecipeAssessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QaRunnerRegistration" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "connectionTokenId" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "runnerVersion" TEXT NOT NULL,
  "protocolVersions" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  "executorKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "publicProfiles" JSONB NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QaRunnerRegistration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QaExecutionAuthorization" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "runnerRegistrationId" TEXT,
  "recipeHash" TEXT NOT NULL,
  "profileKey" TEXT NOT NULL,
  "profileManifestHash" TEXT NOT NULL,
  "productionConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QaExecutionAuthorization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QaExecutionJob" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "authorizationId" TEXT NOT NULL,
  "runnerRegistrationId" TEXT NOT NULL,
  "protocolVersion" INTEGER NOT NULL DEFAULT 1,
  "executorKey" TEXT NOT NULL,
  "profileKey" TEXT NOT NULL,
  "profileManifestHash" TEXT NOT NULL,
  "recipeHash" TEXT NOT NULL,
  "status" "QaExecutionJobStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deadlineAt" TIMESTAMP(3) NOT NULL,
  "claimId" TEXT,
  "runnerInstanceId" TEXT,
  "leaseTokenHash" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastHeartbeatAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "QaExecutionJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QaExecutionEvidenceUpload" (
  "id" TEXT NOT NULL,
  "executionJobId" TEXT NOT NULL,
  "checklistItemId" TEXT NOT NULL,
  "requirementId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumedAt" TIMESTAMP(3),
  CONSTRAINT "QaExecutionEvidenceUpload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QaExecutionRecipe_artifactId_revision_key"
  ON "QaExecutionRecipe"("artifactId", "revision");
CREATE UNIQUE INDEX "QaExecutionRecipe_artifactId_recipeHash_key"
  ON "QaExecutionRecipe"("artifactId", "recipeHash");
CREATE INDEX "QaExecutionRecipe_requestId_createdAt_idx"
  ON "QaExecutionRecipe"("requestId", "createdAt");
CREATE INDEX "QaExecutionRecipe_artifactId_createdAt_idx"
  ON "QaExecutionRecipe"("artifactId", "createdAt");
CREATE INDEX "QaExecutionRecipe_createdByUserId_idx"
  ON "QaExecutionRecipe"("createdByUserId");
CREATE INDEX "QaExecutionRecipe_connectionTokenId_idx"
  ON "QaExecutionRecipe"("connectionTokenId");
CREATE INDEX "QaExecutionRecipe_supersedesRecipeId_idx"
  ON "QaExecutionRecipe"("supersedesRecipeId");

CREATE UNIQUE INDEX "QaExecutionRecipeItem_recipeId_ordinal_key"
  ON "QaExecutionRecipeItem"("recipeId", "ordinal");
CREATE UNIQUE INDEX "QaExecutionRecipeItem_recipeId_checklistItemId_key"
  ON "QaExecutionRecipeItem"("recipeId", "checklistItemId");
CREATE INDEX "QaExecutionRecipeItem_checklistItemId_idx"
  ON "QaExecutionRecipeItem"("checklistItemId");
CREATE INDEX "QaExecutionRecipeAssessment_recipeId_createdAt_idx"
  ON "QaExecutionRecipeAssessment"("recipeId", "createdAt");

CREATE UNIQUE INDEX "QaRunnerRegistration_connectionTokenId_instanceId_key"
  ON "QaRunnerRegistration"("connectionTokenId", "instanceId");
CREATE INDEX "QaRunnerRegistration_projectId_lastSeenAt_idx"
  ON "QaRunnerRegistration"("projectId", "lastSeenAt");
CREATE INDEX "QaRunnerRegistration_connectionTokenId_lastSeenAt_idx"
  ON "QaRunnerRegistration"("connectionTokenId", "lastSeenAt");

CREATE UNIQUE INDEX "QaExecutionAuthorization_runId_key"
  ON "QaExecutionAuthorization"("runId");
CREATE INDEX "QaExecutionAuthorization_recipeId_approvedAt_idx"
  ON "QaExecutionAuthorization"("recipeId", "approvedAt");
CREATE INDEX "QaExecutionAuthorization_runnerRegistrationId_approvedAt_idx"
  ON "QaExecutionAuthorization"("runnerRegistrationId", "approvedAt");
CREATE INDEX "QaExecutionAuthorization_artifactId_idx"
  ON "QaExecutionAuthorization"("artifactId");
CREATE INDEX "QaExecutionAuthorization_approvedByUserId_idx"
  ON "QaExecutionAuthorization"("approvedByUserId");

CREATE UNIQUE INDEX "QaExecutionJob_runId_key" ON "QaExecutionJob"("runId");
CREATE UNIQUE INDEX "QaExecutionJob_authorizationId_key" ON "QaExecutionJob"("authorizationId");
CREATE INDEX "QaExecutionJob_status_availableAt_leaseExpiresAt_idx"
  ON "QaExecutionJob"("status", "availableAt", "leaseExpiresAt");
CREATE INDEX "QaExecutionJob_runnerRegistrationId_status_availableAt_idx"
  ON "QaExecutionJob"("runnerRegistrationId", "status", "availableAt");
CREATE INDEX "QaExecutionJob_requestId_createdAt_idx"
  ON "QaExecutionJob"("requestId", "createdAt");
CREATE INDEX "QaExecutionJob_projectId_idx"
  ON "QaExecutionJob"("projectId");
CREATE INDEX "QaExecutionJob_artifactId_idx"
  ON "QaExecutionJob"("artifactId");
CREATE INDEX "QaExecutionJob_recipeId_idx"
  ON "QaExecutionJob"("recipeId");

CREATE UNIQUE INDEX "QaExecutionEvidenceUpload_assetId_key"
  ON "QaExecutionEvidenceUpload"("assetId");
CREATE INDEX "QaExecutionEvidenceUpload_executionJobId_consumedAt_idx"
  ON "QaExecutionEvidenceUpload"("executionJobId", "consumedAt");
CREATE INDEX "QaExecutionEvidenceUpload_requirementId_idx"
  ON "QaExecutionEvidenceUpload"("requirementId");
CREATE INDEX "QaExecutionEvidenceUpload_checklistItemId_idx"
  ON "QaExecutionEvidenceUpload"("checklistItemId");
CREATE INDEX "ExternalIdempotencyRecord_state_expiresAt_idx"
  ON "ExternalIdempotencyRecord"("state", "expiresAt");

CREATE INDEX "QaRun_executionRecipeId_idx"
  ON "QaRun"("executionRecipeId");
CREATE INDEX "QaGenerationExecution_artifactId_idx"
  ON "QaGenerationExecution"("artifactId");
CREATE INDEX "QaGenerationExecution_recipeId_idx"
  ON "QaGenerationExecution"("recipeId");

ALTER TABLE "QaExecutionRecipe"
  ADD CONSTRAINT "QaExecutionRecipe_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "QaRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionRecipe_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "QaArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionRecipe_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionRecipe_connectionTokenId_fkey" FOREIGN KEY ("connectionTokenId") REFERENCES "ProjectConnectionToken"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionRecipe_supersedesRecipeId_fkey" FOREIGN KEY ("supersedesRecipeId") REFERENCES "QaExecutionRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QaExecutionRecipeItem"
  ADD CONSTRAINT "QaExecutionRecipeItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "QaExecutionRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionRecipeItem_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "QaChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QaExecutionRecipeAssessment"
  ADD CONSTRAINT "QaExecutionRecipeAssessment_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "QaExecutionRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QaRunnerRegistration"
  ADD CONSTRAINT "QaRunnerRegistration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QaRunnerRegistration_connectionTokenId_fkey" FOREIGN KEY ("connectionTokenId") REFERENCES "ProjectConnectionToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QaExecutionAuthorization"
  ADD CONSTRAINT "QaExecutionAuthorization_runId_fkey" FOREIGN KEY ("runId") REFERENCES "QaRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionAuthorization_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "QaExecutionRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionAuthorization_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "QaArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionAuthorization_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionAuthorization_runnerRegistrationId_fkey" FOREIGN KEY ("runnerRegistrationId") REFERENCES "QaRunnerRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QaExecutionJob"
  ADD CONSTRAINT "QaExecutionJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionJob_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "QaRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "QaRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionJob_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "QaArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionJob_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "QaExecutionRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionJob_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "QaExecutionAuthorization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionJob_runnerRegistrationId_fkey" FOREIGN KEY ("runnerRegistrationId") REFERENCES "QaRunnerRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QaExecutionEvidenceUpload"
  ADD CONSTRAINT "QaExecutionEvidenceUpload_executionJobId_fkey" FOREIGN KEY ("executionJobId") REFERENCES "QaExecutionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionEvidenceUpload_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "QaChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionEvidenceUpload_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "QaEvidenceRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QaExecutionEvidenceUpload_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "StoredAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QaRun"
  ADD CONSTRAINT "QaRun_executionRecipeId_fkey" FOREIGN KEY ("executionRecipeId") REFERENCES "QaExecutionRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QaGenerationExecution"
  ADD CONSTRAINT "QaGenerationExecution_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "QaArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "QaGenerationExecution_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "QaExecutionRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
