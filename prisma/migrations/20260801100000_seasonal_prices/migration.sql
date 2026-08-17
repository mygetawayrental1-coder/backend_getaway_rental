-- Seasonal pricing date-range overrides
CREATE TABLE IF NOT EXISTS "SeasonalPrice" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "nightlyRate" INTEGER NOT NULL,
    "weekendRate" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SeasonalPrice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SeasonalPrice_propertyId_startDate_endDate_idx"
  ON "SeasonalPrice"("propertyId", "startDate", "endDate");
CREATE INDEX IF NOT EXISTS "SeasonalPrice_propertyId_isActive_idx"
  ON "SeasonalPrice"("propertyId", "isActive");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SeasonalPrice_propertyId_fkey'
  ) THEN
    ALTER TABLE "SeasonalPrice"
      ADD CONSTRAINT "SeasonalPrice_propertyId_fkey"
      FOREIGN KEY ("propertyId") REFERENCES "Property"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Migrate legacy single rate period into one seasonal row when dates exist
INSERT INTO "SeasonalPrice" ("id", "propertyId", "name", "startDate", "endDate", "nightlyRate", "weekendRate", "isActive", "createdAt", "updatedAt")
SELECT
  replace(gen_random_uuid()::text, '-', ''),
  p."id",
  'Season',
  p."ratePeriodStart",
  p."ratePeriodEnd",
  CASE WHEN p."nightlyRate" > 0 THEN p."nightlyRate" ELSE p."minRate" END,
  CASE WHEN p."weekendRate" > 0 THEN p."weekendRate" ELSE NULL END,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Property" p
WHERE p."ratePeriodStart" IS NOT NULL
  AND p."ratePeriodEnd" IS NOT NULL
  AND p."ratePeriodStart" <= p."ratePeriodEnd"
  AND (p."nightlyRate" > 0 OR p."minRate" > 0)
  AND NOT EXISTS (
    SELECT 1 FROM "SeasonalPrice" s WHERE s."propertyId" = p."id"
  );
