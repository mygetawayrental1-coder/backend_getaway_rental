const crypto = require('crypto');
const prisma = require('../config/database');
const paypalClient = require('../config/paypal');
const { OrdersController } = require('@paypal/paypal-server-sdk');
const { getPagination, formatPaginatedResponse } = require('../utils/helpers');

// Create PayPal order
const createOrder = async (req, res) => {
    try {
        if (!paypalClient) {
            return res.status(503).json({
                success: false,
                message: 'Payment service not configured. Please contact administrator.',
            });
        }

        const { amount, currency = 'USD', type, subscriptionId } = req.body;
        const userId = req.user.id;

        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid amount is required.',
            });
        }

        const ordersController = new OrdersController(paypalClient);

        // Create PayPal order
        const orderPayload = {
            body: {
                intent: 'CAPTURE',
                purchaseUnits: [
                    {
                        amount: {
                            currencyCode: currency,
                            value: amount.toString(),
                        },
                        description: type === 'subscription'
                            ? 'MyGetawayRental Subscription'
                            : 'MyGetawayRental Booking',
                    },
                ],
            },
            prefer: 'return=representation',
        };

        const { body: order } = await ordersController.ordersCreate(orderPayload);

        // Save payment record
        const payment = await prisma.payment.create({
            data: {
                paypalOrderId: order.id,
                amount: parseFloat(amount),
                currency,
                type: type || 'subscription',
                userId,
                subscriptionId: subscriptionId || null,
            },
        });

        res.json({
            success: true,
            data: {
                orderId: order.id,
                amount,
                currency,
                paymentId: payment.id,
                approvalUrl: order.links?.find(link => link.rel === 'approve')?.href,
            },
        });
    } catch (error) {
        console.error('Create PayPal order error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create payment order.',
            error: error.message,
        });
    }
};

// Capture PayPal payment (after user approves)
const verifyPayment = async (req, res) => {
    try {
        if (!paypalClient) {
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

        const ordersController = new OrdersController(paypalClient);

        // Capture the payment
        const { body: captureData } = await ordersController.ordersCapture({
            id: orderId,
            prefer: 'return=representation',
        });

        if (captureData.status !== 'COMPLETED') {
            return res.status(400).json({
                success: false,
                message: 'Payment not completed.',
                status: captureData.status,
            });
        }

        // Update payment record
        const captureId = captureData.purchaseUnits?.[0]?.payments?.captures?.[0]?.id;

        const payment = await prisma.payment.update({
            where: { paypalOrderId: orderId },
            data: {
                paypalPaymentId: captureId,
                status: 'paid',
            },
            include: {
                subscription: true,
            },
        });

        // If subscription payment, update subscription status
        if (payment.subscriptionId) {
            await prisma.userSubscription.update({
                where: { id: payment.subscriptionId },
                data: { status: 'ACTIVE' },
            });
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
            error: error.message,
        });
    }
};

// Get payment history
const getPaymentHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page, limit, status } = req.query;
        const pagination = getPagination(page, limit);

        const where = { userId };
        if (status) where.status = status;

        // Admins can see all payments
        if (req.user.role === 'ADMIN') {
            delete where.userId;
        }

        const [payments, total] = await Promise.all([
            prisma.payment.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: {
                        select: { id: true, email: true, firstName: true, lastName: true },
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
            ...formatPaginatedResponse(payments, total, pagination.page, pagination.limit),
        });
    } catch (error) {
        console.error('Get payment history error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment history.',
        });
    }
};

// Get payment by ID
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

        // Check authorization
        if (req.user.role !== 'ADMIN' && payment.userId !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        res.json({
            success: true,
            data: payment,
        });
    } catch (error) {
        console.error('Get payment by ID error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment.',
        });
    }
};

module.exports = {
    createOrder,
    verifyPayment,
    getPaymentHistory,
    getPaymentById,
};
