ALTER TABLE "QaBrowserRuntime"
  ADD COLUMN "loginPhase" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "loginEpoch" TEXT,
  ADD COLUMN "loginDeadlineAt" TIMESTAMP(3);
ALTER TABLE "QaBrowserRuntime" ADD CONSTRAINT "QaBrowserRuntime_login_phase_check"
  CHECK ("loginPhase" IN ('NONE','WAITING','ENTER_REQUESTED','LOGIN','FINISH_REQUESTED','READY'));
ALTER TABLE "QaBrowserRuntime" ADD CONSTRAINT "QaBrowserRuntime_login_binding_check"
  CHECK (("loginPhase"='NONE' AND "loginEpoch" IS NULL AND "loginDeadlineAt" IS NULL)
    OR ("loginPhase"<>'NONE' AND "loginEpoch" IS NOT NULL AND "loginDeadlineAt" IS NOT NULL));
