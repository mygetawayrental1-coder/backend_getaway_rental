-- Checkout form field definitions + guest request custom answers
CREATE TABLE IF NOT EXISTS "CheckoutField" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "placeholder" TEXT,
    "section" TEXT NOT NULL DEFAULT 'extras',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CheckoutField_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CheckoutField_name_key" ON "CheckoutField"("name");
CREATE INDEX IF NOT EXISTS "CheckoutField_isActive_idx" ON "CheckoutField"("isActive");
CREATE INDEX IF NOT EXISTS "CheckoutField_section_idx" ON "CheckoutField"("section");
CREATE INDEX IF NOT EXISTS "CheckoutField_sortOrder_idx" ON "CheckoutField"("sortOrder");

ALTER TABLE "GuestRequest" ADD COLUMN IF NOT EXISTS "customFields" TEXT;
