-- Platform booking charges (service fee, cleaning fee, etc.)
CREATE TABLE IF NOT EXISTS "BookingCharge" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "calcType" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BookingCharge_name_key" ON "BookingCharge"("name");
CREATE INDEX IF NOT EXISTS "BookingCharge_isActive_idx" ON "BookingCharge"("isActive");
CREATE INDEX IF NOT EXISTS "BookingCharge_sortOrder_idx" ON "BookingCharge"("sortOrder");

-- Default 10% service fee (matches previous hardcoded website rate)
INSERT INTO "BookingCharge" ("id", "name", "label", "calcType", "value", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT
    'cm_seed_service_fee_001',
    'service_fee',
    'Service fee',
    'percent',
    10,
    true,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM "BookingCharge" WHERE "name" = 'service_fee'
);
