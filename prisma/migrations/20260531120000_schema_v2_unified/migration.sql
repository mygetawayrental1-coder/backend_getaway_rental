-- =============================================================================
-- MyGetawayRental — Schema v2.0 Migration
-- From: current backend/prisma/schema.prisma (legacy JWT + Clerk hybrid)
-- To:   unified Clerk-only schema (Downloads/schema.prisma v2.0)
--
-- ⚠️  RUN ON A BACKUP FIRST. Review SCHEMA_V2_MIGRATION_STUDY.md before apply.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PHASE 1: User — Clerk-only auth, drop legacy JWT/password fields
-- ---------------------------------------------------------------------------

-- Backfill clerkId for rows created before Clerk sync (required before NOT NULL)
UPDATE "User"
SET "clerkId" = 'legacy_' || "id"
WHERE "clerkId" IS NULL;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Drop legacy auth columns (irreversible — ensure all clients use Clerk)
ALTER TABLE "User" DROP COLUMN IF EXISTS "password";
ALTER TABLE "User" DROP COLUMN IF EXISTS "emailVerified";
ALTER TABLE "User" DROP COLUMN IF EXISTS "verifyToken";
ALTER TABLE "User" DROP COLUMN IF EXISTS "resetToken";
ALTER TABLE "User" DROP COLUMN IF EXISTS "resetTokenExpiry";

ALTER TABLE "User" ALTER COLUMN "clerkId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User"("email");
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");
CREATE INDEX IF NOT EXISTS "User_isActive_idx" ON "User"("isActive");

-- ---------------------------------------------------------------------------
-- PHASE 2: OwnerRequest
-- ---------------------------------------------------------------------------

ALTER TABLE "OwnerRequest" ADD COLUMN IF NOT EXISTS "adminReply" TEXT;

CREATE INDEX IF NOT EXISTS "OwnerRequest_userId_idx" ON "OwnerRequest"("userId");
CREATE INDEX IF NOT EXISTS "OwnerRequest_status_idx" ON "OwnerRequest"("status");

-- ---------------------------------------------------------------------------
-- PHASE 3: Property — richer listing fields + indexes
-- ---------------------------------------------------------------------------

ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "suitability" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "checkInTime" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "checkOutTime" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "minNights" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "maxNights" INTEGER;

-- Align capacity defaults with v2 (existing rows unchanged; defaults for new inserts)
ALTER TABLE "Property" ALTER COLUMN "guests" SET DEFAULT 1;
ALTER TABLE "Property" ALTER COLUMN "bedrooms" SET DEFAULT 1;
ALTER TABLE "Property" ALTER COLUMN "bathrooms" SET DEFAULT 1;

CREATE INDEX IF NOT EXISTS "Property_ownerId_idx" ON "Property"("ownerId");
CREATE INDEX IF NOT EXISTS "Property_status_idx" ON "Property"("status");
CREATE INDEX IF NOT EXISTS "Property_rentalType_idx" ON "Property"("rentalType");
CREATE INDEX IF NOT EXISTS "Property_location_idx" ON "Property"("location");
CREATE INDEX IF NOT EXISTS "Property_isFeatured_idx" ON "Property"("isFeatured");
CREATE INDEX IF NOT EXISTS "Property_slug_idx" ON "Property"("slug");

-- ---------------------------------------------------------------------------
-- PHASE 4: PropertyAvailability (NEW)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "PropertyAvailability" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyAvailability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PropertyAvailability_propertyId_date_key"
    ON "PropertyAvailability"("propertyId", "date");
CREATE INDEX IF NOT EXISTS "PropertyAvailability_propertyId_idx"
    ON "PropertyAvailability"("propertyId");

ALTER TABLE "PropertyAvailability" DROP CONSTRAINT IF EXISTS "PropertyAvailability_propertyId_fkey";
ALTER TABLE "PropertyAvailability" ADD CONSTRAINT "PropertyAvailability_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PHASE 5: GuestRequest — indexes only
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "GuestRequest_propertyId_idx" ON "GuestRequest"("propertyId");
CREATE INDEX IF NOT EXISTS "GuestRequest_status_idx" ON "GuestRequest"("status");
CREATE INDEX IF NOT EXISTS "GuestRequest_email_idx" ON "GuestRequest"("email");

-- ---------------------------------------------------------------------------
-- PHASE 6: Inquiry — pricing snapshot + admin notes
-- ---------------------------------------------------------------------------

ALTER TABLE "Inquiry" ADD COLUMN IF NOT EXISTS "nightlyRate" DOUBLE PRECISION;
ALTER TABLE "Inquiry" ADD COLUMN IF NOT EXISTS "adminNotes" TEXT;

CREATE INDEX IF NOT EXISTS "Inquiry_propertyId_idx" ON "Inquiry"("propertyId");
CREATE INDEX IF NOT EXISTS "Inquiry_userId_idx" ON "Inquiry"("userId");
CREATE INDEX IF NOT EXISTS "Inquiry_status_idx" ON "Inquiry"("status");
CREATE INDEX IF NOT EXISTS "Inquiry_email_idx" ON "Inquiry"("email");

-- ---------------------------------------------------------------------------
-- PHASE 7: Booking — full lifecycle + guestClerkId
-- ---------------------------------------------------------------------------

ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "weekendRate" INTEGER;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "guestClerkId" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "cancelledBy" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "ownerNotes" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "checkedInAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);

-- Backfill lifecycle timestamps from existing status values
UPDATE "Booking"
SET "confirmedAt" = "createdAt"
WHERE "status" IN ('CONFIRMED', 'COMPLETED') AND "confirmedAt" IS NULL;

UPDATE "Booking"
SET "completedAt" = "updatedAt"
WHERE "status" = 'COMPLETED' AND "completedAt" IS NULL;

UPDATE "Booking"
SET "cancelledAt" = "updatedAt"
WHERE "status" = 'CANCELLED' AND "cancelledAt" IS NULL;

-- v2 default for new bookings is PENDING; existing CONFIRMED rows stay as-is
ALTER TABLE "Booking" ALTER COLUMN "status" SET DEFAULT 'PENDING';

CREATE INDEX IF NOT EXISTS "Booking_guestEmail_idx" ON "Booking"("guestEmail");
CREATE INDEX IF NOT EXISTS "Booking_guestClerkId_idx" ON "Booking"("guestClerkId");

-- ---------------------------------------------------------------------------
-- PHASE 8: BookingPayment (NEW)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "BookingPayment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentMethod" TEXT,
    "transactionId" TEXT,
    "gatewayData" TEXT,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BookingPayment_bookingId_key" ON "BookingPayment"("bookingId");

ALTER TABLE "BookingPayment" DROP CONSTRAINT IF EXISTS "BookingPayment_bookingId_fkey";
ALTER TABLE "BookingPayment" ADD CONSTRAINT "BookingPayment_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PHASE 9: Review — author link + owner reply + updatedAt
-- ---------------------------------------------------------------------------

ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "authorId" TEXT;
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "ownerReply" TEXT;
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "ownerRepliedAt" TIMESTAMP(3);
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "Review_isApproved_idx" ON "Review"("isApproved");
CREATE INDEX IF NOT EXISTS "Review_authorId_idx" ON "Review"("authorId");

ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_authorId_fkey";
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PHASE 10: SubscriptionPlan + Coupon + UserSubscription
-- ---------------------------------------------------------------------------

ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "maxProperties" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "SubscriptionPlan_status_idx" ON "SubscriptionPlan"("status");

CREATE TABLE IF NOT EXISTS "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" DOUBLE PRECISION NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "planId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Coupon_code_key" ON "Coupon"("code");
CREATE INDEX IF NOT EXISTS "Coupon_isActive_idx" ON "Coupon"("isActive");

ALTER TABLE "Coupon" DROP CONSTRAINT IF EXISTS "Coupon_planId_fkey";
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserSubscription" ADD COLUMN IF NOT EXISTS "autoRenew" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserSubscription" ADD COLUMN IF NOT EXISTS "couponId" TEXT;

CREATE INDEX IF NOT EXISTS "UserSubscription_userId_idx" ON "UserSubscription"("userId");
CREATE INDEX IF NOT EXISTS "UserSubscription_status_idx" ON "UserSubscription"("status");

ALTER TABLE "UserSubscription" DROP CONSTRAINT IF EXISTS "UserSubscription_couponId_fkey";
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_couponId_fkey"
    FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PHASE 11: Payment indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "Payment_userId_idx" ON "Payment"("userId");
CREATE INDEX IF NOT EXISTS "Payment_status_idx" ON "Payment"("status");

-- ---------------------------------------------------------------------------
-- PHASE 12: Payout (NEW)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Payout" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "method" TEXT,
    "reference" TEXT,
    "period" TEXT,
    "notes" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Payout_ownerId_idx" ON "Payout"("ownerId");
CREATE INDEX IF NOT EXISTS "Payout_status_idx" ON "Payout"("status");
CREATE INDEX IF NOT EXISTS "Payout_period_idx" ON "Payout"("period");

ALTER TABLE "Payout" DROP CONSTRAINT IF EXISTS "Payout_ownerId_fkey";
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PHASE 13: Notification (NEW)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");
CREATE INDEX IF NOT EXISTS "Notification_userId_idx" ON "Notification"("userId");
CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification"("createdAt");

ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_userId_fkey";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PHASE 14: Conversation + Message + M2M participants (NEW)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Conversation" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT,
    "bookingId" TEXT,
    "ownerId" TEXT NOT NULL,
    "guestId" TEXT,
    "guestEmail" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Conversation_propertyId_idx" ON "Conversation"("propertyId");
CREATE INDEX IF NOT EXISTS "Conversation_ownerId_idx" ON "Conversation"("ownerId");
CREATE INDEX IF NOT EXISTS "Conversation_guestId_idx" ON "Conversation"("guestId");
CREATE INDEX IF NOT EXISTS "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt");

ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_propertyId_fkey";
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "_ConversationParticipant" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "_ConversationParticipant_AB_unique"
    ON "_ConversationParticipant"("A", "B");
CREATE INDEX IF NOT EXISTS "_ConversationParticipant_B_index" ON "_ConversationParticipant"("B");

ALTER TABLE "_ConversationParticipant" DROP CONSTRAINT IF EXISTS "_ConversationParticipant_A_fkey";
ALTER TABLE "_ConversationParticipant" ADD CONSTRAINT "_ConversationParticipant_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_ConversationParticipant" DROP CONSTRAINT IF EXISTS "_ConversationParticipant_B_fkey";
ALTER TABLE "_ConversationParticipant" ADD CONSTRAINT "_ConversationParticipant_B_fkey"
    FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT,
    "receiverId" TEXT,
    "senderName" TEXT,
    "senderEmail" TEXT,
    "content" TEXT NOT NULL,
    "attachment" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Message_conversationId_idx" ON "Message"("conversationId");
CREATE INDEX IF NOT EXISTS "Message_receiverId_isRead_idx" ON "Message"("receiverId", "isRead");
CREATE INDEX IF NOT EXISTS "Message_createdAt_idx" ON "Message"("createdAt");

ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_conversationId_fkey";
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_senderId_fkey";
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_receiverId_fkey";
ALTER TABLE "Message" ADD CONSTRAINT "Message_receiverId_fkey"
    FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PHASE 15: SupportTicket + TicketReply (NEW)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "SupportTicket" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "adminNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupportTicket_ticketId_key" ON "SupportTicket"("ticketId");
CREATE INDEX IF NOT EXISTS "SupportTicket_userId_idx" ON "SupportTicket"("userId");
CREATE INDEX IF NOT EXISTS "SupportTicket_status_idx" ON "SupportTicket"("status");
CREATE INDEX IF NOT EXISTS "SupportTicket_priority_idx" ON "SupportTicket"("priority");

ALTER TABLE "SupportTicket" DROP CONSTRAINT IF EXISTS "SupportTicket_userId_fkey";
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "TicketReply" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketReply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TicketReply_ticketId_idx" ON "TicketReply"("ticketId");

ALTER TABLE "TicketReply" DROP CONSTRAINT IF EXISTS "TicketReply_ticketId_fkey";
ALTER TABLE "TicketReply" ADD CONSTRAINT "TicketReply_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PHASE 16: Website models — BlogPost, Location, Newsletter, WebContact
-- ---------------------------------------------------------------------------

ALTER TABLE "BlogPost" ADD COLUMN IF NOT EXISTS "readTimeMin" INTEGER;
ALTER TABLE "BlogPost" ADD COLUMN IF NOT EXISTS "tags" TEXT;

CREATE INDEX IF NOT EXISTS "BlogPost_isPublished_idx" ON "BlogPost"("isPublished");
CREATE INDEX IF NOT EXISTS "BlogPost_category_idx" ON "BlogPost"("category");
CREATE INDEX IF NOT EXISTS "BlogPost_slug_idx" ON "BlogPost"("slug");

ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "Location_parentSlug_idx" ON "Location"("parentSlug");
CREATE INDEX IF NOT EXISTS "Location_isActive_idx" ON "Location"("isActive");

ALTER TABLE "NewsletterSubscriber" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "NewsletterSubscriber" ADD COLUMN IF NOT EXISTS "unsubscribedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "NewsletterSubscriber_isActive_idx" ON "NewsletterSubscriber"("isActive");

ALTER TABLE "WebContactMessage" ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "WebContactMessage_isRead_idx" ON "WebContactMessage"("isRead");
CREATE INDEX IF NOT EXISTS "WebContactMessage_email_idx" ON "WebContactMessage"("email");

CREATE INDEX IF NOT EXISTS "Wishlist_userId_idx" ON "Wishlist"("userId");

-- ---------------------------------------------------------------------------
-- PHASE 17: IcalEvent — summary + date-range index
-- ---------------------------------------------------------------------------

ALTER TABLE "IcalEvent" ADD COLUMN IF NOT EXISTS "summary" TEXT;

CREATE INDEX IF NOT EXISTS "IcalEvent_dtStart_dtEnd_idx" ON "IcalEvent"("dtStart", "dtEnd");

-- Optional: normalize legacy source spelling (non-destructive)
UPDATE "IcalEvent" SET "source" = 'mygetawayrental' WHERE "source" = 'mygatewayrental';
