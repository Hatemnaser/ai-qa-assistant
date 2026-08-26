-- Support bounded retention scans and the global usage guard without full-table scans.
-- This is intentionally forward-only because all earlier migrations may already be applied.
CREATE INDEX "User_emailVerifiedAt_createdAt_id_idx"
  ON "User"("emailVerifiedAt", "createdAt", "id");

CREATE INDEX "PasswordResetToken_usedAt_idx"
  ON "PasswordResetToken"("usedAt");

CREATE INDEX "EmailVerificationToken_usedAt_idx"
  ON "EmailVerificationToken"("usedAt");

CREATE INDEX "StoredAsset_status_readyAt_idx"
  ON "StoredAsset"("status", "readyAt");

CREATE INDEX "AiUsageLog_createdAt_id_idx"
  ON "AiUsageLog"("createdAt", "id");

CREATE INDEX "UsageEvent_action_createdAt_idx"
  ON "UsageEvent"("action", "createdAt");

CREATE INDEX "UsageEvent_createdAt_id_idx"
  ON "UsageEvent"("createdAt", "id");
