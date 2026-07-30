-- Property owner/marketing links
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "personalWebsiteUrl" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "virtualTourUrl" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "socialMediaUrls" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "cityClassified" BOOLEAN NOT NULL DEFAULT false;

-- SubscriptionPlan structured entitlements
ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "priceUnit" TEXT NOT NULL DEFAULT 'FLAT';
ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "maxPhotos" INTEGER;
ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "maxCalendarSyncs" INTEGER;
ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "bookingManagement" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "supportType" TEXT NOT NULL DEFAULT 'EMAIL';
ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "personalWebsiteLink" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "socialMediaLinks" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "cityClassifiedListing" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "virtualTourLink" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "homepageFeaturedListing" BOOLEAN NOT NULL DEFAULT false;
