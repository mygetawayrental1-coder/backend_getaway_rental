const rateLimit = require('express-rate-limit');

/**
 * Build a rate limiter with a consistent JSON error shape.
 */
function makeLimiter({ windowMs, max, message }) {
    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,  // Return rate limit info in `RateLimit-*` headers
        legacyHeaders: false,   // Disable `X-RateLimit-*` headers
        handler: (req, res) => {
            res.status(429).json({
                success: false,
                message,
            });
        },
    });
}

/**
 * Global limiter — applied to every request.
 * 500 requests per IP per 15 minutes.
 */
const globalLimiter = makeLimiter({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: 'Too many requests from this IP, please try again after 15 minutes.',
});

/**
 * Auth limiter — applied to /auth/* routes.
 * 30 requests per IP per 15 minutes — blocks brute-force login attempts.
 */
const authLimiter = makeLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: 'Too many authentication attempts. Please try again after 15 minutes.',
});

/**
 * Booking limiter — applied to /bookings/* routes.
 * 60 requests per IP per 10 minutes.
 */
const bookingLimiter = makeLimiter({
    windowMs: 10 * 60 * 1000,
    max: 60,
    message: 'Too many booking requests. Please slow down and try again shortly.',
});

/**
 * Upload limiter — applied to /uploads/* routes.
 * 40 uploads per IP per 10 minutes — prevents storage flooding.
 */
const uploadLimiter = makeLimiter({
    windowMs: 10 * 60 * 1000,
    max: 40,
    message: 'Too many file uploads. Please wait before uploading more files.',
});

/**
 * Guest request / contact form limiter.
 * 20 submissions per IP per 15 minutes — prevents form spam.
 */
const guestRequestLimiter = makeLimiter({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: 'Too many form submissions. Please wait before submitting again.',
});

/**
 * Payment limiter — applied to /payments/* routes.
 * 20 requests per IP per 15 minutes — added layer on top of PayPal protections.
 */
const paymentLimiter = makeLimiter({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: 'Too many payment requests. Please wait before trying again.',
});

module.exports = {
    globalLimiter,
    authLimiter,
    bookingLimiter,
    uploadLimiter,
    guestRequestLimiter,
    paymentLimiter,
};
