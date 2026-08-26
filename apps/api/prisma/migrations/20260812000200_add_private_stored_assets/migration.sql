CREATE TYPE "StoredAssetPurpose" AS ENUM ('CHAT_ATTACHMENT', 'PROJECT_DOCUMENT_SOURCE');
CREATE TYPE "StoredAssetStatus" AS ENUM ('PENDING', 'VALIDATING', 'READY', 'FAILED', 'DELETE_PENDING');

CREATE TABLE "StoredAsset" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "projectId" TEXT,
  "objectKey" TEXT NOT NULL,
  "purpose" "StoredAssetPurpose" NOT NULL,
  "status" "StoredAssetStatus" NOT NULL DEFAULT 'PENDING',
  "originalName" TEXT NOT NULL,
  "declaredMimeType" TEXT NOT NULL,
  "detectedMimeType" TEXT,
  "expectedSizeBytes" INTEGER NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "sizeBytes" INTEGER,
  "etag" TEXT,
  "uploadExpiresAt" TIMESTAMP(3),
  "validationStartedAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoredAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessageAttachment" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ObjectDeletionJob" (
  "id" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ObjectDeletionJob_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProjectDocument" ADD COLUMN "sourceAssetId" TEXT;

CREATE UNIQUE INDEX "StoredAsset_objectKey_key" ON "StoredAsset"("objectKey");
CREATE INDEX "StoredAsset_ownerId_status_idx" ON "StoredAsset"("ownerId", "status");
CREATE INDEX "StoredAsset_projectId_status_idx" ON "StoredAsset"("projectId", "status");
CREATE INDEX "StoredAsset_status_uploadExpiresAt_idx" ON "StoredAsset"("status", "uploadExpiresAt");
CREATE INDEX "StoredAsset_status_validationStartedAt_idx" ON "StoredAsset"("status", "validationStartedAt");
CREATE UNIQUE INDEX "MessageAttachment_assetId_key" ON "MessageAttachment"("assetId");
CREATE UNIQUE INDEX "MessageAttachment_messageId_ordinal_key" ON "MessageAttachment"("messageId", "ordinal");
CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");
CREATE UNIQUE INDEX "ObjectDeletionJob_objectKey_key" ON "ObjectDeletionJob"("objectKey");
CREATE INDEX "ObjectDeletionJob_nextAttemptAt_idx" ON "ObjectDeletionJob"("nextAttemptAt");
CREATE UNIQUE INDEX "ProjectDocument_sourceAssetId_key" ON "ProjectDocument"("sourceAssetId");

ALTER TABLE "StoredAsset" ADD CONSTRAINT "StoredAsset_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoredAsset" ADD CONSTRAINT "StoredAsset_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "StoredAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_sourceAssetId_fkey"
  FOREIGN KEY ("sourceAssetId") REFERENCES "StoredAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
