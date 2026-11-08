const prisma = require('../config/database');
const {
  client: paypalClient,
  isPayPalConfigured,
  getPayPalMode,
  getWebsiteBaseUrl,
} = require('../config/paypal');
const { OrdersController } = require('@paypal/paypal-server-sdk');
const { getPagination, formatPaginatedResponse } = require('../utils/helpers');
const { reconcileUserRole } = require('../services/subscriptionAccess.service');
const { applyCoupon } = require('./coupon.controller');

function allowedWebOrigin(origin) {
  if (!origin || typeof origin !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.hostname.endsWith('.vercel.app') || parsed.hostname.endsWith('.up.railway.app')) return null;
  if (parsed.hostname === 'mygetawayrental.com') return 'https://www.mygetawayrental.com';
  const list = `${process.env.WEBSITE_URL || ''},${process.env.FRONTEND_URL || ''}`;
  const ok = list.split(',').some((entry) => {
    const raw = entry.trim();
    if (!raw.startsWith('http')) return false;
    try {
      return new URL(raw).origin === parsed.origin;
    } catch {
      return false;
    }
  });
  return ok ? parsed.origin : null;
}

function safeReturnPath(returnPath) {
  const raw = String(returnPath || '/pricing?paypal=success');
  if (!raw.startsWith('/') || raw.startsWith('//')) {
    return '/pricing?paypal=success';
  }
  return raw;
}

// Allow deep-link URLs from the mobile app (e.g. mgwr://payment/success)
function safeAppReturnUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  // Only allow custom scheme URLs — never arbitrary http(s) to prevent open-redirect
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(trimmed) && !trimmed.startsWith('http')) {
    return trimmed;
  }
  return null;
}

function capturedAmount(captureData) {
  const raw =
    captureData?.purchaseUnits?.[0]?.payments?.captures?.[0]?.amount?.value ??
    captureData?.purchaseUnits?.[0]?.amount?.value;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function expectedSubscriptionAmount(sub) {
  let expected =
    sub.plan.specialPrice != null && sub.plan.specialPrice > 0
      ? sub.plan.specialPrice
      : sub.plan.price;
  if (sub.coupon && sub.coupon.isActive) {
    if (sub.coupon.discountType === 'PERCENT') {
      expected = expected * (1 - sub.coupon.discountValue / 100);
    } else if (sub.coupon.discountType === 'FIXED') {
      expected = Math.max(0, expected - sub.coupon.discountValue);
    }
  }
  return Math.round(expected * 100) / 100;
}

async function createPayPalOrderForSubscription({ userId, subscriptionId, returnPath, returnOrigin, returnUrl: returnUrlOverride, cancelUrl: cancelUrlOverride }) {
  if (!isPayPalConfigured()) {
    const err = new Error('Payment service not configured.');
    err.status = 503;
    throw err;
  }

  const owned = await prisma.userSubscription.findFirst({
    where: { id: subscriptionId, userId, status: 'PENDING' },
    include: { plan: true, coupon: true },
  });
  if (!owned) {
    const err = new Error('Invalid or expired checkout. Start subscribe again.');
    err.status = 403;
    throw err;
  }

  const chargeAmount = expectedSubscriptionAmount(owned);
  if (chargeAmount <= 0) {
    const err = new Error('No payment required for this subscription.');
    err.status = 400;
    throw err;
  }

  const website = allowedWebOrigin(returnOrigin) || getWebsiteBaseUrl();
  // Mobile app passes deep-link returnUrl (e.g. mgwr://payment/success)
  // Web passes returnPath which we append to the site the user was signed in on
  const returnUrl =
    safeAppReturnUrl(returnUrlOverride) ??
    `${website}${safeReturnPath(returnPath)}`;
  const cancelUrl =
    safeAppReturnUrl(cancelUrlOverride) ??
    `${website}/pricing?paypal=cancelled`;

  const ordersController = new OrdersController(paypalClient);
  const orderPayload = {
    body: {
      intent: 'CAPTURE',
      purchaseUnits: [
        {
          amount: {
            currencyCode: 'USD',
            value: chargeAmount.toFixed(2),
          },
          description: `MyGetawayRental — ${owned.plan.name}`,
          customId: subscriptionId,
        },
      ],
      applicationContext: {
        brandName: 'MyGetawayRental',
        landingPage: 'NO_PREFERENCE',
        userAction: 'PAY_NOW',
        returnUrl,
        cancelUrl,
      },
    },
    prefer: 'return=representation',
  };

  const { result: order } = await ordersController.createOrder(orderPayload);

  const payment = await prisma.payment.create({
    data: {
      paypalOrderId: order.id,
      amount: chargeAmount,
      currency: 'USD',
      status: 'created',
      type: 'subscription',
      userId,
      subscriptionId,
    },
  });

  return {
    orderId: order.id,
    amount: chargeAmount,
    currency: 'USD',
    paymentId: payment.id,
    approvalUrl: order.links?.find((link) => link.rel === 'approve')?.href,
    mode: getPayPalMode(),
  };
}

const createOrder = async (req, res) => {
  try {
    if (!isPayPalConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Payment service not configured. Please contact administrator.',
      });
    }

    const { subscriptionId, returnPath, returnOrigin, returnUrl, cancelUrl } = req.body;
    const userId = req.user.id;

    if (!subscriptionId) {
      return res.status(400).json({
        success: false,
        message: 'A subscription is required to start checkout.',
      });
    }

    const paypal = await createPayPalOrderForSubscription({
      userId,
      subscriptionId,
      returnPath,
      returnOrigin,
      returnUrl,
      cancelUrl,
    });
    return res.json({ success: true, data: paypal });
  } catch (error) {
    console.error('Create PayPal order error:', error?.result || error);
    const details = Array.isArray(error?.result?.details) ? error.result.details : [];
    const detailText = details.map((d) => d.description || d.issue).filter(Boolean).join(' ');
    const status = error.statusCode || error.status || 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      message: detailText || error.message || 'Failed to create payment order.',
    });
  }
};

async function activateSubscriptionAfterPayment(subscriptionId, userId) {
  const sub = await prisma.userSubscription.findUnique({
    where: { id: subscriptionId },
  });
  if (!sub || sub.status !== 'PENDING') {
    return false;
  }

  if (sub.couponId) {
    try {
      await applyCoupon(sub.couponId);
    } catch (err) {
      console.warn('[payments] coupon increment skipped:', err.message);
    }
  }

  await prisma.userSubscription.update({
    where: { id: subscriptionId },
    data: { status: 'ACTIVE' },
  });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user && user.role !== 'ADMIN' && user.role !== 'OWNER') {
    await prisma.user.update({
      where: { id: userId },
      data: { role: 'OWNER' },
    });
  }
  try {
    await reconcileUserRole(userId);
  } catch (_) {
    /* optional */
  }
  return true;
}

async function finalizePayPalOrder(orderId, { actorUserId, actorRole } = {}) {
  const pending = await prisma.payment.findUnique({
    where: { paypalOrderId: orderId },
    include: { subscription: true },
  });
  if (!pending) {
    const err = new Error('Payment record not found for this order.');
    err.status = 404;
    throw err;
  }
  if (actorUserId && actorRole !== 'ADMIN' && pending.userId !== actorUserId) {
    const err = new Error('Access denied.');
    err.status = 403;
    throw err;
  }
  if (pending.status === 'paid') {
    return prisma.payment.findUnique({
      where: { paypalOrderId: orderId },
      include: {
        subscription: { include: { plan: true } },
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    });
  }

  const ordersController = new OrdersController(paypalClient);
  let captureData;
  try {
    const { result } = await ordersController.captureOrder({
      id: orderId,
      prefer: 'return=representation',
    });
    captureData = result;
  } catch (captureErr) {
    const already = String(captureErr.message || '').toLowerCase();
    if (already.includes('already captured') || already.includes('order already')) {
      const { result } = await ordersController.getOrder({ id: orderId });
      captureData = result;
    } else {
      await prisma.payment.update({
        where: { paypalOrderId: orderId },
        data: { status: 'failed' },
      });
      throw captureErr;
    }
  }

  if (captureData.status !== 'COMPLETED') {
    await prisma.payment.update({
      where: { paypalOrderId: orderId },
      data: { status: 'failed' },
    });
    const err = new Error('Payment not completed.');
    err.status = 400;
    throw err;
  }

  const paid = capturedAmount(captureData);
  const expected = Math.round(Number(pending.amount) * 100) / 100;
  if (paid == null || Math.abs(paid - expected) > 0.05) {
    await prisma.payment.update({
      where: { paypalOrderId: orderId },
      data: { status: 'failed' },
    });
    const err = new Error('Paid amount did not match the plan price.');
    err.status = 400;
    throw err;
  }

  const captureId =
    captureData.purchaseUnits?.[0]?.payments?.captures?.[0]?.id;

  const payment = await prisma.payment.update({
    where: { paypalOrderId: orderId },
    data: {
      paypalPaymentId: captureId,
      status: 'paid',
    },
    include: {
      subscription: { include: { plan: true } },
      user: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
  });

  if (payment.subscriptionId) {
    await activateSubscriptionAfterPayment(
      payment.subscriptionId,
      pending.userId,
    );
  }
  return payment;
}

const verifyPayment = async (req, res) => {
  try {
    if (!isPayPalConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Payment service not configured.',
      });
    }

    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'PayPal order ID is required.',
      });
    }

    const payment = await finalizePayPalOrder(orderId, {
      actorUserId: req.user.id,
      actorRole: req.user.role,
    });

    res.json({
      success: true,
      message: 'Payment verified successfully.',
      data: payment,
    });
  } catch (error) {
    console.error('Verify PayPal payment error:', error);
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Payment verification failed.',
      ...(process.env.NODE_ENV === 'development' && { error: error.message }),
    });
  }
};

const getPaymentHistory = async (req, res) => {
  try {
    const { page, limit, status, type } = req.query;
    const pagination = getPagination(page, limit, { maxLimit: 500 });

    const where = {};
    if (req.user.role !== 'ADMIN') {
      where.userId = req.user.id;
    }
    if (status) {
      where.status =
        status === 'pending' ? 'created' : String(status).toLowerCase();
    }
    if (type) where.type = type;
    else if (req.user.role === 'ADMIN') where.type = 'subscription';

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          subscription: {
            include: { plan: true },
          },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    res.json({
      success: true,
      paypalMode: getPayPalMode(),
      ...formatPaginatedResponse(
        payments,
        total,
        pagination.page,
        pagination.limit,
      ),
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history.',
    });
  }
};

const getPaymentById = async (req, res) => {
  try {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        subscription: {
          include: { plan: true },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found.',
      });
    }

    if (req.user.role !== 'ADMIN' && payment.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    res.json({ success: true, data: payment });
  } catch (error) {
    console.error('Get payment by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment.',
    });
  }
};

const getPayPalStatus = async (_req, res) => {
  res.json({
    success: true,
    configured: isPayPalConfigured(),
  });
};

module.exports = {
  createOrder,
  verifyPayment,
  getPaymentHistory,
  getPaymentById,
  getPayPalStatus,
  finalizePayPalOrder,
  createPayPalOrderForSubscription,
  expectedSubscriptionAmount,
};
