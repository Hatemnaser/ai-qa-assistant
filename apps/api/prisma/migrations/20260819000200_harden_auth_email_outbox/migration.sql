CREATE INDEX "AuthEmailJob_status_expiresAt_idx"
  ON "AuthEmailJob"("status", "expiresAt");

CREATE INDEX "AuthEmailJob_status_updatedAt_idx"
  ON "AuthEmailJob"("status", "updatedAt");
