-- Property manual sort order (admin destination / homepage ordering)
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "Property_sortOrder_idx" ON "Property"("sortOrder");
