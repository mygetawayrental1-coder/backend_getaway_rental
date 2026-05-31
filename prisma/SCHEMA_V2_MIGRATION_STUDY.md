# Schema v2.0 Migration Study

**Source (new):** `Downloads/schema.prisma` — MyGetawayRental Unified Prisma Schema v2.0  
**Target (old):** `backend/prisma/schema.prisma` (pre-migration)  
**Migration SQL:** `migrations/20260531120000_schema_v2_unified/migration.sql`

---

## Executive summary

v2.0 is a **platform-unification** schema: one PostgreSQL database for Next.js web, Flutter mobile, React admin, and Express backend — with **Clerk-only authentication** (no stored passwords, no legacy JWT fields).

| Area | Change magnitude |
|------|------------------|
| Auth (`User`) | **Breaking** — drop password/JWT columns; `clerkId` required |
| Bookings | **Major** — lifecycle states, payment split, timestamps |
| Messaging | **New** — `Conversation`, `Message`, participants M2M |
| Ops / admin | **New** — `Notification`, `SupportTicket`, `Payout`, `Coupon` |
| Listings | **Additive** — availability calendar, suitability, check-in rules |
| Website | **Additive** — blog tags, location flags, newsletter unsubscribe |

---

## 1. Authentication model (biggest breaking change)

### Old
```prisma
clerkId     String?   @unique   // optional hybrid
password    String              // bcrypt for mobile/legacy
emailVerified, verifyToken, resetToken, resetTokenExpiry
```

### New
```prisma
clerkId  String  @unique   // required — sole identity
isActive Boolean @default(true)
// NO password, NO email verification tokens
```

### Migration strategy
1. Backfill `clerkId = 'legacy_' || id` for users without Clerk sync.
2. Drop password and token columns.
3. Set `clerkId NOT NULL`.

### Backend impact (must update before deploy)
- Remove `authJwt`, password signup/login, forgot-password flows.
- All clients must use Clerk; webhook must upsert `User` with real `clerkId`.
- Replace `legacy_*` clerkIds when users first sign in via Clerk.

---

## 2. Model-by-model diff

### User
| Field / relation | Old | New |
|------------------|-----|-----|
| `isActive` | — | ✅ admin suspend |
| `password`, tokens | ✅ | ❌ removed |
| `notifications` | — | ✅ |
| `supportTickets`, `payouts` | — | ✅ |
| `reviews` (as author) | — | ✅ |
| `messagesSent/Received`, `conversations` | — | ✅ |
| Indexes | minimal | `email`, `role`, `isActive` |

### Property
| Field | Old | New |
|-------|-----|-----|
| `description` | — | long HTML/text |
| `address` | — | full formatted address |
| `suitability` | — | JSON pets/children/smoking/etc. |
| `checkInTime`, `checkOutTime` | — | e.g. `"15:00"` |
| `minNights`, `maxNights` | — | stay rules |
| Defaults `guests/bedrooms/bathrooms` | 0 | 1 |
| `PropertyAvailability[]` | — | owner block calendar |
| `Conversation[]` | — | messaging per listing |
| Indexes | slug only | ownerId, status, rentalType, location, isFeatured, slug |

### Booking (lifecycle overhaul)
| Aspect | Old | New |
|--------|-----|-----|
| Default `status` | `CONFIRMED` | `PENDING` |
| Status values | CONFIRMED, CANCELLED, COMPLETED | PENDING, CONFIRMED, **ONGOING**, COMPLETED, CANCELLED |
| `guestClerkId` | — | link signed-in guest |
| `weekendRate` | — | pricing snapshot |
| `cancelledBy`, `cancelReason` | — | audit trail |
| `ownerNotes` | — | private owner notes |
| Lifecycle timestamps | — | confirmedAt, checkedInAt, completedAt, cancelledAt |
| Payments | inline in Booking | **`BookingPayment`** 1:1 model |

**Data migration:** existing `CONFIRMED` bookings get `confirmedAt = createdAt`; status values are preserved.

### Review
| Field | Old | New |
|-------|-----|-----|
| `authorId` → User | — | optional link to signed-in reviewer |
| `ownerReply`, `ownerRepliedAt` | — | host response |
| `updatedAt` | — | ✅ |

### Subscription / payments
| Model | Change |
|-------|--------|
| `SubscriptionPlan` | + `maxProperties` (listing limit per plan) |
| `Coupon` | **NEW** — promo codes, optional plan scope |
| `UserSubscription` | + `autoRenew`, + `couponId` |
| `BookingPayment` | **NEW** — separate from subscription `Payment` |
| `Payout` | **NEW** — owner earnings withdrawal requests |

### Messaging (NEW subsystem)
```
Conversation ──< Message
     │
     └── participants (M2M via _ConversationParticipant)
```
- Supports registered guest (`guestId`) or anonymous (`guestEmail`).
- Optional `propertyId` and `bookingId` context.

### Support (NEW)
```
SupportTicket ──< TicketReply
```
Categories: booking, payout, property, account, other.

### OwnerRequest
- + `adminReply` for admin portal responses.

### Website models
| Model | Additions |
|-------|-----------|
| `BlogPost` | `readTimeMin`, `tags` (JSON), indexes |
| `Location` | `description`, `isActive`, `updatedAt` |
| `NewsletterSubscriber` | `isActive`, `unsubscribedAt` |
| `WebContactMessage` | `readAt` |

### IcalEvent
- + `summary`
- + composite index on `(dtStart, dtEnd)`
- Source default renamed `mygetawayrental` (typo fix from `mygatewayrental`)

---

## 3. New tables (10)

1. `PropertyAvailability`
2. `BookingPayment`
3. `Coupon`
4. `Payout`
5. `Notification`
6. `Conversation`
7. `_ConversationParticipant` (implicit M2M)
8. `Message`
9. `SupportTicket`
10. `TicketReply`

---

## 4. Removed columns (irreversible)

From `User`:
- `password`
- `emailVerified`
- `verifyToken`
- `resetToken`
- `resetTokenExpiry`

---

## 5. Recommended apply order

```bash
# 1. Backup production DB
pg_dump $DATABASE_URL > backup_pre_v2.sql

# 2. Replace schema.prisma with v2 (Downloads copy)
cp schema.prisma backend/prisma/schema.prisma

# 3. Apply migration (pick one)
# Option A — raw SQL on Render/psql:
psql $DATABASE_URL -f backend/prisma/migrations/20260531120000_schema_v2_unified/migration.sql

# Option B — Prisma migrate (after copying schema):
cd backend && npx prisma migrate resolve --applied 20260531120000_schema_v2_unified
# or: npx prisma db execute --file prisma/migrations/.../migration.sql

# 4. Regenerate client
npx prisma generate

# 5. Sync legacy clerkIds via Clerk webhook on next login
```

---

## 6. Application code checklist

| Module | Action |
|--------|--------|
| `auth.controller.js` | Remove password login/register/reset; Clerk-only |
| `middleware/auth.js` | Drop JWT fallback if v2 is strict Clerk |
| `booking.controller.js` | Support PENDING→CONFIRMED→ONGOING→COMPLETED; use `BookingPayment` |
| `property.controller.js` | Expose new fields (suitability, minNights, availability) |
| `review` routes | Support `authorId`, owner reply |
| Admin portal | Wire Notification, SupportTicket, Payout, Coupon |
| Flutter app | Migrate to Clerk Flutter SDK; remove password auth |
| Web (Next.js) | Already Clerk — ensure webhook upserts `clerkId` |

---

## 7. Risk notes

1. **`clerkId NOT NULL`** — fails if backfill step is skipped.
2. **Password drop** — mobile users with only password auth lose access until Clerk signup.
3. **Booking default `PENDING`** — new instant-book flow must explicitly confirm; old code assuming auto-CONFIRMED needs update.
4. **`Conversation.ownerId`** — required but no FK in Prisma schema; enforce in application layer or add FK migration later.
5. **Render PostgreSQL** — `ADD COLUMN IF NOT EXISTS` requires PG 9.1+ (fine on Render).

---

## 8. Relation rename (Prisma only, no SQL)

`User.properties` → `User.ownedProperties` — same FK column `Property.ownerId`; no DB change.
