-- IcalEvent: UID unique per property (not globally)
DROP INDEX IF EXISTS "IcalEvent_uid_key";
CREATE UNIQUE INDEX IF NOT EXISTS "IcalEvent_propertyId_uid_key" ON "IcalEvent"("propertyId", "uid");

-- Durable captcha store
CREATE TABLE IF NOT EXISTS "CaptchaChallenge" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaptchaChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CaptchaChallenge_expiresAt_idx" ON "CaptchaChallenge"("expiresAt");
