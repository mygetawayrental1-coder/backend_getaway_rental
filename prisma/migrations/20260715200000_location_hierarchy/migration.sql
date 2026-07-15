-- Location hierarchy: type + parentId (preserve slugs / SEO)
CREATE TYPE "LocationType" AS ENUM ('COUNTRY', 'STATE', 'CITY');

ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "type" "LocationType" NOT NULL DEFAULT 'CITY';
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "parentId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Location_parentId_fkey'
  ) THEN
    ALTER TABLE "Location"
      ADD CONSTRAINT "Location_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "Location"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Location_parentId_idx" ON "Location"("parentId");
CREATE INDEX IF NOT EXISTS "Location_type_idx" ON "Location"("type");
