-- Safety net: Property SEO + customFields (may already exist via db push)
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "customFields" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "seoPathPrefix" TEXT DEFAULT 'properties';
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "seoTitle" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "seoDescription" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "seoKeywords" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "seoCanonicalUrl" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "seoBacklinks" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "seoSchemaType" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "seoSchemaDescription" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "seoSchemaExtra" TEXT;

-- DynamicField (listing form builder) — create if missing
CREATE TABLE IF NOT EXISTS "DynamicField" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "placeholder" TEXT,
    "section" TEXT NOT NULL DEFAULT 'details',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DynamicField_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DynamicField_name_key" ON "DynamicField"("name");

-- SiteSettings key/value store
CREATE TABLE IF NOT EXISTS "SiteSettings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SiteSettings_key_key" ON "SiteSettings"("key");
CREATE INDEX IF NOT EXISTS "SiteSettings_key_idx" ON "SiteSettings"("key");
