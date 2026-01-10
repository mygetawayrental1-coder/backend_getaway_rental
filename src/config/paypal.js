const { Client, Environment, LogLevel } = require('@paypal/paypal-server-sdk');

// Initialize PayPal client
let paypalClient = null;

if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
    paypalClient = new Client({
        clientCredentialsAuthCredentials: {
            oAuthClientId: process.env.PAYPAL_CLIENT_ID,
            oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET,
        },
        environment: process.env.NODE_ENV === 'production'
            ? Environment.Production
            : Environment.Sandbox,
        logging: {
            logLevel: LogLevel.Info,
            logRequest: { logBody: true },
            logResponse: { logHeaders: true },
        },
    });
    console.log('✓ PayPal client initialized');
} else {
    console.log('⚠ PayPal not configured - missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET');
}

module.exports = paypalClient;
