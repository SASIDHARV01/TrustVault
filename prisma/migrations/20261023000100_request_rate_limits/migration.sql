CREATE TABLE "RequestRateLimit" (
  "key" VARCHAR(64) NOT NULL,
  "count" INTEGER NOT NULL,
  "windowStartedAt" TIMESTAMPTZ(6) NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "RequestRateLimit_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "RequestRateLimit_count_check" CHECK ("count" >= 1)
);

CREATE INDEX "RequestRateLimit_updatedAt_idx"
  ON "RequestRateLimit"("updatedAt");
