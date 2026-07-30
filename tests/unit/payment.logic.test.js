/**
 * Payment Logic Unit Tests
 *
 * Tests the server-authoritative price validation logic that
 * prevents users from paying an arbitrary amount for a subscription.
 *
 * This is the MOST CRITICAL test in the codebase — this logic
 * guards real money transactions.
 */

// We extract the pure discount calculation logic inline so we can
// test it independently of the PayPal SDK and Prisma.
// (Same logic lives in payment.controller.js → createOrder)
function computeExpectedPrice(plan, coupon) {
    let expected =
        plan.specialPrice != null && plan.specialPrice > 0
            ? plan.specialPrice
            : plan.price;

    if (coupon && coupon.isActive) {
        if (coupon.discountType === 'PERCENT') {
            expected = expected * (1 - coupon.discountValue / 100);
        } else if (coupon.discountType === 'FIXED') {
            expected = Math.max(0, expected - coupon.discountValue);
        }
    }

    return Math.round(expected * 100) / 100;
}

// ─────────────────────────────────────────────
// computeExpectedPrice
// ─────────────────────────────────────────────
describe('Payment — computeExpectedPrice()', () => {
    const basePlan = { price: 200, specialPrice: null };

    it('uses regular price when no specialPrice', () => {
        expect(computeExpectedPrice(basePlan, null)).toBe(200);
    });

    it('uses specialPrice when set and > 0', () => {
        expect(computeExpectedPrice({ price: 200, specialPrice: 149 }, null)).toBe(149);
    });

    it('ignores specialPrice when it is 0 — falls back to regular price', () => {
        expect(computeExpectedPrice({ price: 200, specialPrice: 0 }, null)).toBe(200);
    });

    it('applies PERCENT coupon correctly (20% off $200 = $160)', () => {
        const coupon = { isActive: true, discountType: 'PERCENT', discountValue: 20 };
        expect(computeExpectedPrice(basePlan, coupon)).toBe(160);
    });

    it('applies FIXED coupon correctly ($200 - $30 = $170)', () => {
        const coupon = { isActive: true, discountType: 'FIXED', discountValue: 30 };
        expect(computeExpectedPrice(basePlan, coupon)).toBe(170);
    });

    it('clamps FIXED coupon so price never goes below $0', () => {
        const coupon = { isActive: true, discountType: 'FIXED', discountValue: 9999 };
        expect(computeExpectedPrice(basePlan, coupon)).toBe(0);
    });

    it('ignores inactive coupons', () => {
        const coupon = { isActive: false, discountType: 'PERCENT', discountValue: 50 };
        expect(computeExpectedPrice(basePlan, coupon)).toBe(200);
    });

    it('rounds to 2 decimal places (floating point safety)', () => {
        // 200 * (1 - 33/100) = 134.0000...  → edge case for floating point
        const coupon = { isActive: true, discountType: 'PERCENT', discountValue: 33 };
        const result = computeExpectedPrice(basePlan, coupon);
        expect(result).toBe(134);
        expect(Number.isFinite(result)).toBe(true);
        expect(result.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
    });

    it('PERCENT coupon on specialPrice: 10% off $149 = $134.10', () => {
        const plan = { price: 200, specialPrice: 149 };
        const coupon = { isActive: true, discountType: 'PERCENT', discountValue: 10 };
        expect(computeExpectedPrice(plan, coupon)).toBe(134.1);
    });
});

// ─────────────────────────────────────────────
// Amount tamper detection (≤ 0.01 tolerance)
// ─────────────────────────────────────────────
describe('Payment — amount tamper detection', () => {
    function isTampered(chargeAmount, expectedAmount) {
        return Math.abs(chargeAmount - expectedAmount) > 0.01;
    }

    it('accepts the exact expected amount', () => {
        expect(isTampered(160.00, 160.00)).toBe(false);
    });

    it('accepts rounding differences within tolerance', () => {
        expect(isTampered(159.99, 160.00)).toBe(false);
    });

    it('rejects when user tries to underpay by $1', () => {
        expect(isTampered(159.00, 160.00)).toBe(true);
    });

    it('rejects when user sends $1 for a $200 plan (extreme tamper)', () => {
        expect(isTampered(1.00, 200.00)).toBe(true);
    });

    it('rejects overpayment tampering too', () => {
        // Overpayment shouldn't be silently accepted either
        expect(isTampered(300.00, 160.00)).toBe(true);
    });
});
