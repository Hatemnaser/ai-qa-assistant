ALTER TABLE "QaBrowserRuntime" ADD COLUMN "saveLoginConsentAt" TIMESTAMP(3), ADD COLUMN "savedLoginId" TEXT;
ALTER TABLE "QaBrowserRuntime" ADD COLUMN "authenticationKind" TEXT NOT NULL DEFAULT 'NONE';
CREATE TABLE "QaSavedBrowserState" (
  "id" TEXT NOT NULL PRIMARY KEY, "ownerId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "targetRevisionId" TEXT NOT NULL, "targetHash" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
  "sourceRuntimeId" TEXT NOT NULL, "sealedState" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3),
  CONSTRAINT "QaSavedBrowserState_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QaSavedBrowserState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QaSavedBrowserState_expiry" CHECK ("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+INTERVAL '7 days'),
  CONSTRAINT "QaSavedBrowserState_revision" CHECK ("revision"=1)
);
CREATE UNIQUE INDEX "QaSavedBrowserState_sourceRuntimeId_key" ON "QaSavedBrowserState"("sourceRuntimeId");
CREATE INDEX "QaSavedBrowserState_projectId_expiresAt_idx" ON "QaSavedBrowserState"("projectId","expiresAt");
CREATE INDEX "QaSavedBrowserState_ownerId_idx" ON "QaSavedBrowserState"("ownerId");
