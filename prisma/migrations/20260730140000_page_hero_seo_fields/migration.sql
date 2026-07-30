-- AlterTable PageHeroConfig — extra SEO fields
ALTER TABLE "PageHeroConfig" ADD COLUMN IF NOT EXISTS "metaKeywords" TEXT;
ALTER TABLE "PageHeroConfig" ADD COLUMN IF NOT EXISTS "canonicalUrl" TEXT;
ALTER TABLE "PageHeroConfig" ADD COLUMN IF NOT EXISTS "robotsIndex" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PageHeroConfig" ADD COLUMN IF NOT EXISTS "robotsFollow" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PageHeroConfig" ADD COLUMN IF NOT EXISTS "schemaType" TEXT;
ALTER TABLE "PageHeroConfig" ADD COLUMN IF NOT EXISTS "schemaDescription" TEXT;
ALTER TABLE "PageHeroConfig" ADD COLUMN IF NOT EXISTS "schemaExtra" TEXT;
