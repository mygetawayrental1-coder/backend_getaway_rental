/**
 * Unit Tests — Pure logic functions (no database, no HTTP)
 * These are fast (< 1ms each) and need zero setup.
 *
 * Covers:
 *   - calculateNights
 *   - calculateTotalAmount (nightly + weekend rates)
 *   - validateDateRange
 *   - hasConflicts
 *   - conflictMessage
 *   - getPagination
 *   - parseJsonField / stringifyJsonField
 */

const {
    calculateNights,
    calculateTotalAmount,
    validateDateRange,
    hasConflicts,
    conflictMessage,
    utcStartOfDay,
} = require('../../src/utils/stayAvailability');

const {
    getPagination,
    parseJsonField,
    stringifyJsonField,
    formatPaginatedResponse,
} = require('../../src/utils/helpers');

// ─────────────────────────────────────────────
// calculateNights
// ─────────────────────────────────────────────
describe('calculateNights()', () => {
    it('returns 3 for a 3-night stay', () => {
        const cin  = new Date('2026-08-01T00:00:00Z');
        const cout = new Date('2026-08-04T00:00:00Z');
        expect(calculateNights(cin, cout)).toBe(3);
    });

    it('returns 1 for a same-evening next-day checkout', () => {
        const cin  = new Date('2026-08-01T00:00:00Z');
        const cout = new Date('2026-08-02T00:00:00Z');
        expect(calculateNights(cin, cout)).toBe(1);
    });

    it('returns 0 when checkin === checkout', () => {
        const d = new Date('2026-08-05T00:00:00Z');
        expect(calculateNights(d, d)).toBe(0);
    });
});

// ─────────────────────────────────────────────
// calculateTotalAmount — weekend rate logic
// ─────────────────────────────────────────────
describe('calculateTotalAmount()', () => {
    it('uses nightlyRate for every day when no weekendRate', () => {
        // Mon 2026-08-03 → Thu 2026-08-06 (3 nights, all weekdays)
        const cin  = new Date(Date.UTC(2026, 7, 3));  // Monday
        const cout = new Date(Date.UTC(2026, 7, 6));  // Thursday
        expect(calculateTotalAmount(cin, cout, 100, null)).toBe(300);
    });

    it('applies weekendRate on Sat and Sun', () => {
        // Fri 2026-08-07 → Mon 2026-08-10  → Fri(100) + Sat(150) + Sun(150) = 400
        const cin  = new Date(Date.UTC(2026, 7, 7));  // Friday
        const cout = new Date(Date.UTC(2026, 7, 10)); // Monday
        expect(calculateTotalAmount(cin, cout, 100, 150)).toBe(400);
    });

    it('ignores weekendRate when it is 0', () => {
        const cin  = new Date(Date.UTC(2026, 7, 7));  // Friday
        const cout = new Date(Date.UTC(2026, 7, 10));
        // weekendRate=0 → treated as no weekend rate
        expect(calculateTotalAmount(cin, cout, 100, 0)).toBe(300);
    });
});

// ─────────────────────────────────────────────
// validateDateRange
// ─────────────────────────────────────────────
describe('validateDateRange()', () => {
    const future = (daysFromNow) => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() + daysFromNow);
        return utcStartOfDay(d);
    };

    it('returns null for a valid future range', () => {
        expect(validateDateRange(future(2), future(5))).toBeNull();
    });

    it('returns error when checkout <= checkin', () => {
        const d = future(3);
        expect(validateDateRange(d, d)).toMatch(/after/i);
    });

    it('returns error for a past checkin', () => {
        const yesterday = new Date();
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        const past = utcStartOfDay(yesterday);
        expect(validateDateRange(past, future(2))).toMatch(/past/i);
    });

    it('returns error when dates are null', () => {
        expect(validateDateRange(null, null)).toMatch(/required/i);
    });
});

// ─────────────────────────────────────────────
// hasConflicts
// ─────────────────────────────────────────────
describe('hasConflicts()', () => {
    const empty = { ownerBlocked: false, bookings: [], acceptedRequests: [], icalEvents: [] };

    it('returns false when there are no conflicts', () => {
        expect(hasConflicts(empty)).toBe(false);
    });

    it('returns true when ownerBlocked', () => {
        expect(hasConflicts({ ...empty, ownerBlocked: true })).toBe(true);
    });

    it('returns true when there is an existing booking', () => {
        expect(hasConflicts({ ...empty, bookings: [{ id: 'b1' }] })).toBe(true);
    });

    it('returns true when there is an iCal block', () => {
        expect(hasConflicts({ ...empty, icalEvents: [{ id: 'e1' }] })).toBe(true);
    });

    it('returns true when there is an accepted guest request', () => {
        expect(hasConflicts({ ...empty, acceptedRequests: [{ id: 'r1' }] })).toBe(true);
    });
});

// ─────────────────────────────────────────────
// conflictMessage
// ─────────────────────────────────────────────
describe('conflictMessage()', () => {
    it('mentions "blocked" when owner blocked', () => {
        expect(conflictMessage({ ownerBlocked: true })).toMatch(/blocked/i);
    });

    it('mentions "booking" for booking conflicts', () => {
        expect(conflictMessage({ ownerBlocked: false, bookings: [{}] })).toMatch(/booking/i);
    });

    it('mentions "iCal" for calendar conflicts', () => {
        expect(conflictMessage({ ownerBlocked: false, bookings: [], acceptedRequests: [], icalEvents: [{}] })).toMatch(/ical/i);
    });
});

// ─────────────────────────────────────────────
// getPagination
// ─────────────────────────────────────────────
describe('getPagination()', () => {
    it('defaults to page 1, limit 10', () => {
        const { page, limit, skip } = getPagination();
        expect(page).toBe(1);
        expect(limit).toBe(10);
        expect(skip).toBe(0);
    });

    it('calculates correct skip for page 3, limit 5', () => {
        const { skip } = getPagination(3, 5);
        expect(skip).toBe(10);
    });

    it('clamps limit to maxLimit (100 default)', () => {
        const { limit } = getPagination(1, 9999);
        expect(limit).toBe(100);
    });

    it('clamps page to minimum 1', () => {
        const { page } = getPagination(-5, 10);
        expect(page).toBe(1);
    });

    it('handles string numbers', () => {
        const { page, limit } = getPagination('2', '20');
        expect(page).toBe(2);
        expect(limit).toBe(20);
    });
});

// ─────────────────────────────────────────────
// parseJsonField / stringifyJsonField
// ─────────────────────────────────────────────
describe('parseJsonField()', () => {
    it('parses a JSON array string', () => {
        expect(parseJsonField('["Wi-Fi","Pool"]')).toEqual(['Wi-Fi', 'Pool']);
    });

    it('parses a JSON object string', () => {
        expect(parseJsonField('{"pets":true}')).toEqual({ pets: true });
    });

    it('returns null for null/undefined', () => {
        expect(parseJsonField(null)).toBeNull();
        expect(parseJsonField(undefined)).toBeNull();
    });

    it('returns the raw string if not valid JSON', () => {
        expect(parseJsonField('not-json')).toBe('not-json');
    });
});

describe('stringifyJsonField()', () => {
    it('stringifies an array', () => {
        expect(stringifyJsonField(['a', 'b'])).toBe('["a","b"]');
    });

    it('returns existing string as-is', () => {
        expect(stringifyJsonField('already')).toBe('already');
    });

    it('returns null for null/undefined', () => {
        expect(stringifyJsonField(null)).toBeNull();
    });
});

// ─────────────────────────────────────────────
// formatPaginatedResponse
// ─────────────────────────────────────────────
describe('formatPaginatedResponse()', () => {
    it('calculates totalPages correctly', () => {
        const res = formatPaginatedResponse([], 25, 1, 10);
        expect(res.pagination.totalPages).toBe(3);
    });

    it('sets hasMore correctly when more pages exist', () => {
        const res = formatPaginatedResponse([], 25, 2, 10);
        expect(res.pagination.hasMore).toBe(true);
    });

    it('sets hasMore=false on last page', () => {
        const res = formatPaginatedResponse([], 25, 3, 10);
        expect(res.pagination.hasMore).toBe(false);
    });
});
