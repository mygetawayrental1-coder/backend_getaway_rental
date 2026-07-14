-- Bind properties to Admin Locations (nullable FK). Existing pages keep working via name fallback.
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "locationId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Property_locationId_fkey'
  ) THEN
    ALTER TABLE "Property"
      ADD CONSTRAINT "Property_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "Location"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Property_locationId_idx" ON "Property"("locationId");

-- Best-effort backfill: exact name match on location or state
UPDATE "Property" p
SET "locationId" = l.id
FROM "Location" l
WHERE p."locationId" IS NULL
  AND (
    LOWER(TRIM(p.location)) = LOWER(TRIM(l.name))
    OR (p.state IS NOT NULL AND LOWER(TRIM(p.state)) = LOWER(TRIM(l.name)))
  );
