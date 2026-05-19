-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "guestId" TEXT,
    "ipHash" TEXT,
    "action" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageEvent_userId_action_createdAt_idx" ON "UsageEvent"("userId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_guestId_action_createdAt_idx" ON "UsageEvent"("guestId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_ipHash_action_createdAt_idx" ON "UsageEvent"("ipHash", "action", "createdAt");

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
