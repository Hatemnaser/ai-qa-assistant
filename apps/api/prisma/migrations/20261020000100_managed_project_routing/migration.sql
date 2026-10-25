-- Nullable for all historical/manual connections. Never re-creates a revoked binding.
ALTER TABLE "ProjectConnectionToken" ADD COLUMN "managedHostId" TEXT;
CREATE UNIQUE INDEX "ProjectConnectionToken_projectId_managedHostId_key"
ON "ProjectConnectionToken"("projectId", "managedHostId");
