ALTER TABLE "QaCheckResult" ADD COLUMN "provenance" JSONB;
ALTER TABLE "QaEvidence" ADD COLUMN "provenance" JSONB;
ALTER TABLE "StoredAsset" ADD COLUMN "evidenceExpiresAt" TIMESTAMP(3);
CREATE INDEX "StoredAsset_purpose_evidenceExpiresAt_status_idx" ON "StoredAsset"("purpose", "evidenceExpiresAt", "status");
ALTER TABLE "QaEvidenceAsset" ADD COLUMN "snapshot" JSONB;
ALTER TABLE "QaEvidenceAsset" ADD COLUMN "unavailableReason" TEXT;
ALTER TABLE "QaEvidenceAsset" ALTER COLUMN "assetId" DROP NOT NULL;
ALTER TABLE "QaEvidenceAsset" DROP CONSTRAINT "QaEvidenceAsset_assetId_fkey";
ALTER TABLE "QaEvidenceAsset" ADD CONSTRAINT "QaEvidenceAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "StoredAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Preserve original descriptors; legacy objects have no retrospective expiry.
UPDATE "QaEvidenceAsset" AS binding SET "snapshot" = jsonb_build_object(
  'id', asset."id", 'originalName', asset."originalName", 'declaredMimeType', asset."declaredMimeType",
  'detectedMimeType', asset."detectedMimeType", 'sizeBytes', asset."sizeBytes",
  'checksumSha256', asset."checksumSha256", 'evidenceExpiresAt', NULL)
FROM "StoredAsset" AS asset WHERE binding."assetId" = asset."id";
CREATE TABLE "QaImportedArchive" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceDigest" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QaImportedArchive_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QaImportedArchive_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "QaImportedArchive_projectId_importedAt_idx" ON "QaImportedArchive"("projectId", "importedAt");
