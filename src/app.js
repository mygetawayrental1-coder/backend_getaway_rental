const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

// Import routes
const authRoutes = require('./routes/auth.routes');
const propertyRoutes = require('./routes/property.routes');
const inquiryRoutes = require('./routes/inquiry.routes');
const userRoutes = require('./routes/user.routes');
const ownerRoutes = require('./routes/owner.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const paymentRoutes = require('./routes/payment.routes');
const uploadRoutes = require('./routes/upload.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const captchaRoutes = require('./routes/captcha.routes');
const guestRequestRoutes = require('./routes/guestRequest.routes');
const bookingRoutes = require('./routes/booking.routes');
const notificationRoutes = require('./routes/notification.routes');
const payoutRoutes = require('./routes/payout.routes');
const messageRoutes = require('./routes/message.routes');
const supportRoutes = require('./routes/supportTicket.routes');
const couponRoutes = require('./routes/coupon.routes');
const reviewRoutes = require('./routes/review.routes');
const ownerRequestRoutes = require('./routes/ownerRequest.routes');
const icalRoutes = require('./routes/ical.routes');
const webhookRoutes = require('./routes/webhook.routes');
const webPropertiesRoutes = require('./routes/web/properties.routes');
const webBlogRoutes = require('./routes/web/blog.routes');
const webLocationsRoutes = require('./routes/web/locations.routes');
const webWishlistRoutes = require('./routes/web/wishlist.routes');
const webNewsletterRoutes = require('./routes/web/newsletter.routes');
const webContactRoutes = require('./routes/web/contact.routes');
const webPricingRoutes = require('./routes/web/pricing.routes');
const webHostsRoutes = require('./routes/web/hosts.routes');
const { startIcalScheduler } = require('./utils/ical.scheduler');

const app = express();

// Behind reverse proxies (Render, etc.) so rate limiting and secure cookies work correctly
app.set('trust proxy', 1);

// Start background cron jobs
startIcalScheduler();

// Middleware
app.use(morgan('dev')); // Log HTTP requests
app.use(cors({
    origin: '*',
    credentials: true,
}));

// Clerk webhooks require raw body for signature verification (must be before express.json)
app.use('/webhooks', webhookRoutes);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from uploads directory
const uploadDir = process.env.UPLOAD_DIR || './uploads';
app.use('/uploads', express.static(path.resolve(uploadDir)));

// Health check
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'MyGatewayRental API is running',
        version: '1.0.0',
        endpoints: {
            auth: '/auth',
            properties: '/properties',
            inquiries: '/inquiries',
            users: '/users',
            owners: '/owners',
            subscriptions: '/subscriptions',
            payments: '/payments',
            uploads: '/uploads',
            dashboard: '/dashboard',
            bookings: '/bookings',
            notifications: '/notifications',
            payouts: '/payouts',
            messages: '/messages',
            support: '/support',
            coupons: '/coupons',
            reviews: '/reviews',
            ical: '/ical',
            web: '/api/web',
            webHosts: '/api/web/hosts',
            webLocationsProperties: '/api/web/locations/:slug/properties',
            webhooks: '/webhooks',
        },
    });
});

// API Routes (mobile + admin)
app.use('/auth', authRoutes);
app.use('/properties', propertyRoutes);
app.use('/inquiries', inquiryRoutes);
app.use('/users', userRoutes);
app.use('/user', userRoutes); // Alias for mobile app compatibility
app.use('/owners', ownerRoutes);
app.use('/subscriptions', subscriptionRoutes);
app.use('/payments', paymentRoutes);
app.use('/uploads', uploadRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/captcha', captchaRoutes);
app.use('/guest-requests', guestRequestRoutes);
app.use('/bookings', bookingRoutes);
app.use('/notifications', notificationRoutes);
app.use('/payouts', payoutRoutes);
app.use('/messages', messageRoutes);
app.use('/support', supportRoutes);
app.use('/coupons', couponRoutes);
app.use('/reviews', reviewRoutes);
app.use('/owner-requests', ownerRequestRoutes);
app.use('/ical', icalRoutes);

// Web app (Next.js) — after mobile/admin routes
app.use('/api/web/properties', webPropertiesRoutes);
app.use('/api/web/blog', webBlogRoutes);
app.use('/api/web/locations', webLocationsRoutes);
app.use('/api/web/wishlist', webWishlistRoutes);
app.use('/api/web/newsletter', webNewsletterRoutes);
app.use('/api/web/contact', webContactRoutes);
app.use('/api/web/pricing', webPricingRoutes);
app.use('/api/web/hosts', webHostsRoutes);

// 404 Handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.method} ${req.url} not found`,
    });
});

// Error Handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
});

module.exports = app;
