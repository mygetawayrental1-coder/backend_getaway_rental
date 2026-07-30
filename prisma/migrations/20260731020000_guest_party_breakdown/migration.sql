-- Guest party breakdown on rent requests and bookings
ALTER TABLE "GuestRequest" ADD COLUMN IF NOT EXISTS "adults" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "GuestRequest" ADD COLUMN IF NOT EXISTS "children" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GuestRequest" ADD COLUMN IF NOT EXISTS "pets" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "adults" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "children" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "pets" INTEGER NOT NULL DEFAULT 0;

-- Backfill adults from existing guests where adults is still the default and guests > 1
UPDATE "GuestRequest" SET "adults" = GREATEST("guests", 1) WHERE "adults" = 1 AND "guests" > 1;
UPDATE "Booking" SET "adults" = GREATEST("guests", 1) WHERE "adults" = 1 AND "guests" > 1;
