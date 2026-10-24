CREATE TABLE "AuthAbuseBucket" (
    "key" VARCHAR(64) NOT NULL,
    "hits" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuthAbuseBucket_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "AuthAbuseBucket_hits_check" CHECK ("hits" > 0)
);
CREATE INDEX "AuthAbuseBucket_resetAt_idx" ON "AuthAbuseBucket"("resetAt");
