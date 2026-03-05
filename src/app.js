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
const ownerRequestRoutes = require('./routes/ownerRequest.routes');
const icalRoutes = require('./routes/ical.routes');
const { startIcalScheduler } = require('./utils/ical.scheduler');

const app = express();

// Start background cron jobs
startIcalScheduler();

// Middleware
app.use(morgan('dev')); // Log HTTP requests
// Allowed origins for CORS
const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5173',      // Admin portal
    process.env.APP_URL || 'http://localhost:5000',            // Backend self
    'https://mgwr-admin.vercel.app',                          // Deployed admin portal
    'https://backend-getaway-rental.onrender.com',            // Deployed backend
];

app.use(cors({
    origin: '*',
    credentials: true,
}));
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
            ical: '/ical',
        },
    });
});

// API Routes
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
app.use('/owner-requests', ownerRequestRoutes);
app.use('/ical', icalRoutes);

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
