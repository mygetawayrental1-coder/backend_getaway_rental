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

async function createPayPalOrderForSubscription({ userId, subscriptionId, returnPath }) {
  if (!isPayPalConfigured()) {
    const err = new Error('Payment service not configured.');
    err.status = 503;
    throw err;
  }

  const owned = await prisma.userSubscription.findFirst({
    where: { id: subscriptionId, userId },
    include: { plan: true, coupon: true },
  });
  if (!owned) {
    const err = new Error('Invalid subscription reference.');
    err.status = 403;
    throw err;
  }

  const chargeAmount = expectedSubscriptionAmount(owned);
  if (chargeAmount <= 0) {
    const err = new Error('No payment required for this subscription.');
    err.status = 400;
    throw err;
  }

  const website = getWebsiteBaseUrl();
  const returnUrl = `${website}${returnPath || '/pricing?paypal=success'}`;
  const cancelUrl = `${website}/pricing?paypal=cancelled`;

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

    const { amount, currency = 'USD', type, subscriptionId, returnPath } = req.body;
    const userId = req.user.id;

    if (subscriptionId) {
      const paypal = await createPayPalOrderForSubscription({
        userId,
        subscriptionId,
        returnPath,
      });
      return res.json({ success: true, data: paypal });
    }

    let chargeAmount = parseFloat(amount);
    if (!Number.isFinite(chargeAmount) || chargeAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required.',
      });
    }
    if (String(currency).toUpperCase() !== 'USD') {
      return res.status(400).json({
        success: false,
        message: 'Only USD is supported.',
      });
    }

    const website = getWebsiteBaseUrl();
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
            description:
              type === 'subscription'
                ? 'MyGetawayRental Subscription'
                : 'MyGetawayRental Booking',
          },
        ],
        applicationContext: {
          brandName: 'MyGetawayRental',
          userAction: 'PAY_NOW',
          returnUrl: `${website}/pricing?paypal=success`,
          cancelUrl: `${website}/pricing?paypal=cancelled`,
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
        type: type || 'subscription',
        userId,
      },
    });

    res.json({
      success: true,
      data: {
        orderId: order.id,
        amount: chargeAmount,
        currency: 'USD',
        paymentId: payment.id,
        approvalUrl: order.links?.find((link) => link.rel === 'approve')?.href,
        mode: getPayPalMode(),
      },
    });
  } catch (error) {
    console.error('Create PayPal order error:', error);
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to create payment order.',
      ...(process.env.NODE_ENV === 'development' && { error: error.message }),
    });
  }
};

async function activateSubscriptionAfterPayment(subscriptionId, userId) {
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

    const pending = await prisma.payment.findUnique({
      where: { paypalOrderId: orderId },
    });

    if (!pending) {
      return res.status(404).json({
        success: false,
        message: 'Payment record not found for this order.',
      });
    }

    if (req.user.role !== 'ADMIN' && pending.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    if (pending.status === 'paid') {
      const paid = await prisma.payment.findUnique({
        where: { paypalOrderId: orderId },
        include: {
          subscription: { include: { plan: true } },
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      });
      return res.json({
        success: true,
        message: 'Payment was already verified.',
        data: paid,
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
      await prisma.payment.update({
        where: { paypalOrderId: orderId },
        data: { status: 'failed' },
      });
      throw captureErr;
    }

    if (captureData.status !== 'COMPLETED') {
      await prisma.payment.update({
        where: { paypalOrderId: orderId },
        data: { status: 'failed' },
      });
      return res.status(400).json({
        success: false,
        message: 'Payment not completed.',
        status: captureData.status,
      });
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

    res.json({
      success: true,
      message: 'Payment verified successfully.',
      data: payment,
    });
  } catch (error) {
    console.error('Verify PayPal payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Payment verification failed.',
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

const refundPayment = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Admin only.' });
    }

    const { id } = req.params;
    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found.' });
    }
    if (payment.status !== 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Only paid payments can be refunded.',
      });
    }

    let paypalRefundId = null;
    if (payment.paypalPaymentId && isPayPalConfigured()) {
      try {
        const mode = getPayPalMode();
        const base =
          mode === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';

        const basic = Buffer.from(
          `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
        ).toString('base64');
        const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'grant_type=client_credentials',
        });
        const tokenJson = await tokenRes.json();
        if (!tokenRes.ok || !tokenJson.access_token) {
          throw new Error(tokenJson.error_description || 'PayPal auth failed');
        }

        const refundRes = await fetch(
          `${base}/v2/payments/captures/${payment.paypalPaymentId}/refund`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokenJson.access_token}`,
              'Content-Type': 'application/json',
              Prefer: 'return=representation',
            },
            body: JSON.stringify({}),
          },
        );
        const refundJson = await refundRes.json();
        if (!refundRes.ok) {
          throw new Error(
            refundJson?.message ||
              refundJson?.details?.[0]?.description ||
              'PayPal refund failed',
          );
        }
        paypalRefundId = refundJson.id;
      } catch (paypalErr) {
        console.error('PayPal refund API error:', paypalErr);
        return res.status(502).json({
          success: false,
          message: `PayPal refund failed: ${paypalErr.message}. Payment left as paid.`,
        });
      }
    }

    const updated = await prisma.payment.update({
      where: { id },
      data: { status: 'refunded' },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        subscription: { include: { plan: true } },
      },
    });

    res.json({
      success: true,
      message: paypalRefundId
        ? `Refunded via PayPal (${paypalRefundId}).`
        : 'Marked as refunded.',
      data: updated,
      paypalRefundId,
    });
  } catch (error) {
    console.error('Refund payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refund payment.',
    });
  }
};

const getPayPalStatus = async (_req, res) => {
  res.json({
    success: true,
    configured: isPayPalConfigured(),
    mode: getPayPalMode(),
    currency: 'USD',
  });
};

module.exports = {
  createOrder,
  verifyPayment,
  getPaymentHistory,
  getPaymentById,
  refundPayment,
  getPayPalStatus,
  createPayPalOrderForSubscription,
  expectedSubscriptionAmount,
};
