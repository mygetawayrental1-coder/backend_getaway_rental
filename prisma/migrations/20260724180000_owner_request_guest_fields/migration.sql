-- Allow guest custom-pricing requests (no Clerk user) to appear in Admin.
ALTER TABLE "OwnerRequest" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "OwnerRequest" ADD COLUMN IF NOT EXISTS "guestName" TEXT;
ALTER TABLE "OwnerRequest" ADD COLUMN IF NOT EXISTS "guestEmail" TEXT;

CREATE INDEX IF NOT EXISTS "OwnerRequest_guestEmail_idx" ON "OwnerRequest"("guestEmail");
