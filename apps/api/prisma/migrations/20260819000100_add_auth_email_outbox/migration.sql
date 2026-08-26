CREATE TYPE "AuthEmailKind" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
CREATE TYPE "AuthEmailJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

CREATE TABLE "AuthEmailJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "AuthEmailKind" NOT NULL,
  "status" "AuthEmailJobStatus" NOT NULL DEFAULT 'PENDING',
  "encryptedPayload" TEXT,
  "emailVerificationTokenId" TEXT,
  "passwordResetTokenId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthEmailJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthEmailJob_token_kind_check" CHECK (
    (
      "kind" = 'EMAIL_VERIFICATION'
      AND "emailVerificationTokenId" IS NOT NULL
      AND "passwordResetTokenId" IS NULL
    )
    OR
    (
      "kind" = 'PASSWORD_RESET'
      AND "emailVerificationTokenId" IS NULL
      AND "passwordResetTokenId" IS NOT NULL
    )
  ),
  CONSTRAINT "AuthEmailJob_payload_state_check" CHECK (
    ("status" IN ('PENDING', 'PROCESSING') AND "encryptedPayload" IS NOT NULL)
    OR
    ("status" IN ('SENT', 'FAILED', 'CANCELLED') AND "encryptedPayload" IS NULL)
  ),
  CONSTRAINT "AuthEmailJob_attempts_check" CHECK ("attempts" >= 0)
);

CREATE UNIQUE INDEX "AuthEmailJob_emailVerificationTokenId_key"
  ON "AuthEmailJob"("emailVerificationTokenId");
CREATE UNIQUE INDEX "AuthEmailJob_passwordResetTokenId_key"
  ON "AuthEmailJob"("passwordResetTokenId");
CREATE INDEX "AuthEmailJob_status_nextAttemptAt_idx"
  ON "AuthEmailJob"("status", "nextAttemptAt");
CREATE INDEX "AuthEmailJob_userId_kind_status_idx"
  ON "AuthEmailJob"("userId", "kind", "status");
CREATE INDEX "AuthEmailJob_lockedAt_idx" ON "AuthEmailJob"("lockedAt");

ALTER TABLE "AuthEmailJob" ADD CONSTRAINT "AuthEmailJob_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthEmailJob" ADD CONSTRAINT "AuthEmailJob_emailVerificationTokenId_fkey"
  FOREIGN KEY ("emailVerificationTokenId") REFERENCES "EmailVerificationToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthEmailJob" ADD CONSTRAINT "AuthEmailJob_passwordResetTokenId_fkey"
  FOREIGN KEY ("passwordResetTokenId") REFERENCES "PasswordResetToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
