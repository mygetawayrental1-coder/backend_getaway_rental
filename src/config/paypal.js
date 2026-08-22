const { Client, Environment, LogLevel } = require('@paypal/paypal-server-sdk');

/**
 * PayPal mode:
 * - PAYPAL_MODE=sandbox | live (preferred)
 * - Default: sandbox (safe until explicitly set to live)
 */
function resolvePayPalEnvironment() {
  const mode = String(process.env.PAYPAL_MODE || '').trim().toLowerCase();
  if (mode === 'live' || mode === 'production') return Environment.Production;
  return Environment.Sandbox;
}

let client = null;
let paypalEnvironmentName = 'unconfigured';

if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
  const environment = resolvePayPalEnvironment();
  paypalEnvironmentName =
    environment === Environment.Production ? 'live' : 'sandbox';

  client = new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: process.env.PAYPAL_CLIENT_ID,
      oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET,
    },
    environment,
    logging: {
      logLevel: LogLevel.Info,
      logRequest: { logBody: true },
      logResponse: { logHeaders: true },
    },
  });
  console.log(`✓ PayPal client initialized (${paypalEnvironmentName})`);
} else {
  console.log('⚠ PayPal not configured — missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET');
}

function isPayPalConfigured() {
  return Boolean(client);
}

function getPayPalMode() {
  return paypalEnvironmentName;
}

function getWebsiteBaseUrl() {
  const fromEnv = (process.env.WEBSITE_URL || process.env.FRONTEND_URL || '')
    .split(',')
    .map((u) => u.trim())
    .find((u) => u.startsWith('http'));
  return (fromEnv || 'https://mygetawayrental.com').replace(/\/$/, '');
}

module.exports = {
  client,
  isPayPalConfigured,
  getPayPalMode,
  getWebsiteBaseUrl,
  resolvePayPalEnvironment,
};
