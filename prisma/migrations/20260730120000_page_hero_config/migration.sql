-- CreateTable
CREATE TABLE IF NOT EXISTS "PageHeroConfig" (
    "id" TEXT NOT NULL,
    "pageKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "breadcrumbLabel" TEXT,
    "eyebrow" TEXT,
    "size" TEXT NOT NULL DEFAULT 'md',
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "useCmsValues" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageHeroConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PageHeroConfig_pageKey_key" ON "PageHeroConfig"("pageKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PageHeroConfig_useCmsValues_idx" ON "PageHeroConfig"("useCmsValues");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PageHeroConfig_sortOrder_idx" ON "PageHeroConfig"("sortOrder");
