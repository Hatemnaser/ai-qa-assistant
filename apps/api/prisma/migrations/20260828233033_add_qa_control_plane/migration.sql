-- CreateEnum
CREATE TYPE "QaRequestPhase" AS ENUM ('DRAFT', 'GENERATING', 'CHECKLIST_REVIEW', 'READY_TO_RUN', 'RUNNING', 'EVIDENCE_NEEDED', 'READY_FOR_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'PROCESSING_FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QaArtifactOrigin" AS ENUM ('ODDPATH_GENERATED', 'AGENT_PROVIDED');

-- CreateEnum
CREATE TYPE "QaChecklistAssessmentStatus" AS ENUM ('PENDING', 'PASSED', 'SUGGESTIONS', 'FAILED');

-- CreateEnum
CREATE TYPE "QaRunStatus" AS ENUM ('CREATED', 'ACTIVE', 'RESULTS_SUBMITTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QaRunOutcome" AS ENUM ('NOT_RUN', 'PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "QaCheckResultStatus" AS ENUM ('PASS', 'FAIL', 'BLOCKED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "QaEvidenceKind" AS ENUM ('TEXT', 'SCREENSHOT', 'LOG', 'TRACE', 'FILE', 'REFERENCE');

-- CreateEnum
CREATE TYPE "QaReviewDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "QaActorKind" AS ENUM ('USER', 'INTEGRATION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "QaTransport" AS ENUM ('WEB', 'REST', 'MCP', 'SYSTEM');

-- CreateEnum
CREATE TYPE "QaGenerationKind" AS ENUM ('CHECKLIST_GENERATION', 'CHECKLIST_REVIEW');

-- CreateEnum
CREATE TYPE "QaGenerationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- AlterEnum
ALTER TYPE "StoredAssetPurpose" ADD VALUE 'QA_EVIDENCE';

-- CreateTable
CREATE TABLE "QaRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "target" TEXT,
    "environment" TEXT,
    "acceptanceNotes" TEXT,
    "phase" "QaRequestPhase" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "selectedArtifactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaContextSnapshot" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "sourceManifest" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "retrievalMode" TEXT NOT NULL,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaContextSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaArtifact" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "origin" "QaArtifactOrigin" NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "canonicalJson" JSONB NOT NULL,
    "renderedMarkdown" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),

    CONSTRAINT "QaArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaChecklistItem" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "clientRef" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "priority" TEXT,
    "preconditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expectedResult" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaChecklistAssessment" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "status" "QaChecklistAssessmentStatus" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT,
    "suggestions" JSONB NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "QaChecklistAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaEvidenceRequirement" (
    "id" TEXT NOT NULL,
    "checklistItemId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" "QaEvidenceKind" NOT NULL,
    "description" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaEvidenceRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaRun" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "status" "QaRunStatus" NOT NULL DEFAULT 'CREATED',
    "outcome" "QaRunOutcome" NOT NULL DEFAULT 'NOT_RUN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceLabel" TEXT,
    "externalRunRef" TEXT,
    "commitSha" TEXT,
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaCheckResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "checklistItemId" TEXT NOT NULL,
    "status" "QaCheckResultStatus" NOT NULL,
    "observedResult" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaCheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaEvidence" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "checklistItemId" TEXT,
    "requirementId" TEXT,
    "createdByUserId" TEXT,
    "connectionTokenId" TEXT,
    "actorKind" "QaActorKind" NOT NULL,
    "transport" "QaTransport" NOT NULL,
    "kind" "QaEvidenceKind" NOT NULL,
    "textContent" TEXT,
    "externalReference" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaEvidenceAsset" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "QaEvidenceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaHumanReview" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "decision" "QaReviewDecision" NOT NULL,
    "comment" TEXT,
    "runVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaHumanReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaWorkflowEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "actorKind" "QaActorKind" NOT NULL,
    "actorUserId" TEXT,
    "connectionTokenId" TEXT,
    "transport" "QaTransport" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaWorkflowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaGenerationExecution" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "artifactId" TEXT,
    "kind" "QaGenerationKind" NOT NULL,
    "status" "QaGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKeyHash" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "QaGenerationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectConnectionToken" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectConnectionToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIdempotencyRecord" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "resourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalIdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QaRequest_selectedArtifactId_key" ON "QaRequest"("selectedArtifactId");

-- CreateIndex
CREATE INDEX "QaRequest_projectId_phase_updatedAt_id_idx" ON "QaRequest"("projectId", "phase", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "QaRequest_createdByUserId_createdAt_idx" ON "QaRequest"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "QaContextSnapshot_requestId_createdAt_idx" ON "QaContextSnapshot"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QaContextSnapshot_requestId_version_key" ON "QaContextSnapshot"("requestId", "version");

-- CreateIndex
CREATE INDEX "QaArtifact_requestId_createdAt_idx" ON "QaArtifact"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QaArtifact_requestId_revision_key" ON "QaArtifact"("requestId", "revision");

-- CreateIndex
CREATE INDEX "QaChecklistItem_artifactId_idx" ON "QaChecklistItem"("artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "QaChecklistItem_artifactId_ordinal_key" ON "QaChecklistItem"("artifactId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "QaChecklistItem_artifactId_clientRef_key" ON "QaChecklistItem"("artifactId", "clientRef");

-- CreateIndex
CREATE INDEX "QaChecklistAssessment_artifactId_createdAt_idx" ON "QaChecklistAssessment"("artifactId", "createdAt");

-- CreateIndex
CREATE INDEX "QaEvidenceRequirement_checklistItemId_idx" ON "QaEvidenceRequirement"("checklistItemId");

-- CreateIndex
CREATE UNIQUE INDEX "QaEvidenceRequirement_checklistItemId_ordinal_key" ON "QaEvidenceRequirement"("checklistItemId", "ordinal");

-- CreateIndex
CREATE INDEX "QaRun_requestId_createdAt_id_idx" ON "QaRun"("requestId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "QaRun_requestId_status_idx" ON "QaRun"("requestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QaRun_requestId_externalRunRef_key" ON "QaRun"("requestId", "externalRunRef");

-- CreateIndex
CREATE INDEX "QaCheckResult_runId_idx" ON "QaCheckResult"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "QaCheckResult_runId_checklistItemId_key" ON "QaCheckResult"("runId", "checklistItemId");

-- CreateIndex
CREATE INDEX "QaEvidence_runId_createdAt_idx" ON "QaEvidence"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "QaEvidence_requirementId_createdAt_idx" ON "QaEvidence"("requirementId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QaEvidenceAsset_assetId_key" ON "QaEvidenceAsset"("assetId");

-- CreateIndex
CREATE INDEX "QaEvidenceAsset_evidenceId_idx" ON "QaEvidenceAsset"("evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "QaEvidenceAsset_evidenceId_ordinal_key" ON "QaEvidenceAsset"("evidenceId", "ordinal");

-- CreateIndex
CREATE INDEX "QaHumanReview_requestId_createdAt_idx" ON "QaHumanReview"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "QaHumanReview_runId_createdAt_idx" ON "QaHumanReview"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "QaWorkflowEvent_requestId_createdAt_idx" ON "QaWorkflowEvent"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QaWorkflowEvent_requestId_sequence_key" ON "QaWorkflowEvent"("requestId", "sequence");

-- CreateIndex
CREATE INDEX "QaGenerationExecution_status_availableAt_leaseExpiresAt_idx" ON "QaGenerationExecution"("status", "availableAt", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "QaGenerationExecution_requestId_createdAt_idx" ON "QaGenerationExecution"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QaGenerationExecution_requestId_kind_idempotencyKeyHash_key" ON "QaGenerationExecution"("requestId", "kind", "idempotencyKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectConnectionToken_tokenHash_key" ON "ProjectConnectionToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ProjectConnectionToken_projectId_revokedAt_idx" ON "ProjectConnectionToken"("projectId", "revokedAt");

-- CreateIndex
CREATE INDEX "ProjectConnectionToken_ownerId_createdAt_idx" ON "ProjectConnectionToken"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectConnectionToken_tokenPrefix_idx" ON "ProjectConnectionToken"("tokenPrefix");

-- CreateIndex
CREATE INDEX "ExternalIdempotencyRecord_credentialId_createdAt_idx" ON "ExternalIdempotencyRecord"("credentialId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdempotencyRecord_credentialId_operation_keyHash_key" ON "ExternalIdempotencyRecord"("credentialId", "operation", "keyHash");

-- AddForeignKey
ALTER TABLE "QaRequest" ADD CONSTRAINT "QaRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaRequest" ADD CONSTRAINT "QaRequest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaRequest" ADD CONSTRAINT "QaRequest_selectedArtifactId_fkey" FOREIGN KEY ("selectedArtifactId") REFERENCES "QaArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaContextSnapshot" ADD CONSTRAINT "QaContextSnapshot_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "QaRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaArtifact" ADD CONSTRAINT "QaArtifact_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "QaRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaArtifact" ADD CONSTRAINT "QaArtifact_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "QaContextSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaChecklistItem" ADD CONSTRAINT "QaChecklistItem_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "QaArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaChecklistAssessment" ADD CONSTRAINT "QaChecklistAssessment_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "QaArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvidenceRequirement" ADD CONSTRAINT "QaEvidenceRequirement_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "QaChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaRun" ADD CONSTRAINT "QaRun_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "QaRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaRun" ADD CONSTRAINT "QaRun_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "QaArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaCheckResult" ADD CONSTRAINT "QaCheckResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "QaRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaCheckResult" ADD CONSTRAINT "QaCheckResult_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "QaChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvidence" ADD CONSTRAINT "QaEvidence_runId_fkey" FOREIGN KEY ("runId") REFERENCES "QaRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvidence" ADD CONSTRAINT "QaEvidence_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "QaChecklistItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvidence" ADD CONSTRAINT "QaEvidence_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "QaEvidenceRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvidence" ADD CONSTRAINT "QaEvidence_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvidence" ADD CONSTRAINT "QaEvidence_connectionTokenId_fkey" FOREIGN KEY ("connectionTokenId") REFERENCES "ProjectConnectionToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvidenceAsset" ADD CONSTRAINT "QaEvidenceAsset_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "QaEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvidenceAsset" ADD CONSTRAINT "QaEvidenceAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "StoredAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaHumanReview" ADD CONSTRAINT "QaHumanReview_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "QaRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaHumanReview" ADD CONSTRAINT "QaHumanReview_runId_fkey" FOREIGN KEY ("runId") REFERENCES "QaRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaHumanReview" ADD CONSTRAINT "QaHumanReview_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "QaArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaHumanReview" ADD CONSTRAINT "QaHumanReview_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaWorkflowEvent" ADD CONSTRAINT "QaWorkflowEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "QaRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaWorkflowEvent" ADD CONSTRAINT "QaWorkflowEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaWorkflowEvent" ADD CONSTRAINT "QaWorkflowEvent_connectionTokenId_fkey" FOREIGN KEY ("connectionTokenId") REFERENCES "ProjectConnectionToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaGenerationExecution" ADD CONSTRAINT "QaGenerationExecution_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "QaRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectConnectionToken" ADD CONSTRAINT "ProjectConnectionToken_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectConnectionToken" ADD CONSTRAINT "ProjectConnectionToken_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdempotencyRecord" ADD CONSTRAINT "ExternalIdempotencyRecord_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ProjectConnectionToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
