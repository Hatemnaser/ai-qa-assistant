CREATE TABLE "BinaryAssetRestoreSession" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "attemptToken" TEXT NOT NULL,
  "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BinaryAssetRestoreSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BinaryAssetRestoreSession_attempt_check" CHECK ("attempt" > 0)
);

ALTER TABLE "StoredAsset"
  ADD COLUMN "restoreSessionId" TEXT,
  ADD COLUMN "restoreAttempt" INTEGER;

ALTER TABLE "StoredAsset"
  ADD CONSTRAINT "StoredAsset_restore_fence_check"
  CHECK (
    ("restoreSessionId" IS NULL AND "restoreAttempt" IS NULL)
    OR
    ("restoreSessionId" IS NOT NULL AND "restoreAttempt" IS NOT NULL AND "restoreAttempt" > 0)
  );

CREATE UNIQUE INDEX "BinaryAssetRestoreSession_attemptToken_key"
  ON "BinaryAssetRestoreSession"("attemptToken");
CREATE UNIQUE INDEX "BinaryAssetRestoreSession_id_attempt_key"
  ON "BinaryAssetRestoreSession"("id", "attempt");
CREATE INDEX "BinaryAssetRestoreSession_ownerId_idx"
  ON "BinaryAssetRestoreSession"("ownerId");
CREATE INDEX "BinaryAssetRestoreSession_leaseExpiresAt_idx"
  ON "BinaryAssetRestoreSession"("leaseExpiresAt");
CREATE INDEX "StoredAsset_restoreSessionId_restoreAttempt_status_idx"
  ON "StoredAsset"("restoreSessionId", "restoreAttempt", "status");

ALTER TABLE "BinaryAssetRestoreSession"
  ADD CONSTRAINT "BinaryAssetRestoreSession_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StoredAsset"
  ADD CONSTRAINT "StoredAsset_restoreSessionId_fkey"
  FOREIGN KEY ("restoreSessionId", "restoreAttempt")
  REFERENCES "BinaryAssetRestoreSession"("id", "attempt")
  ON DELETE SET NULL ON UPDATE CASCADE;
