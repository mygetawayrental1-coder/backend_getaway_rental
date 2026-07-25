const prisma = require('../config/database');
const { getPagination, formatPaginatedResponse } = require('../utils/helpers');

function roundMoney(n) {
    return Math.round((n || 0) * 100) / 100;
}

const getEarningsSummary = async (req, res) => {
    try {
        const ownerId = req.user.id;
        
        const acceptedStatuses = ['CONFIRMED', 'ONGOING', 'COMPLETED'];
        
        const totalAgg = await prisma.booking.aggregate({
            where: {
                property: { ownerId },
                status: { in: acceptedStatuses }
            },
            _sum: { totalAmount: true }
        });

        const collectedAgg = await prisma.bookingPayment.aggregate({
            where: {
                booking: {
                    property: { ownerId },
                    status: { in: acceptedStatuses }
                },
                status: 'PAID'
            },
            _sum: { amount: true }
        });

        const totalExpected = roundMoney(totalAgg._sum.totalAmount);
        const totalCollected = roundMoney(collectedAgg._sum.amount);
        const pendingCollection = Math.max(0, roundMoney(totalExpected - totalCollected));

        res.json({
            success: true,
            data: {
                totalEarnings: totalExpected,      
                paidOut: totalCollected,           
                pendingPayouts: pendingCollection, 
                thisMonthEarnings: 0, 
                lastMonthEarnings: 0,
                availableForPayout: 0
            }
        });
    } catch (error) {
        console.error('Get payments summary error:', error);
        res.status(500).json({ success: false, message: 'Failed to load payments summary.' });
    }
};

const getPayoutHistory = async (req, res) => {
    try {
        const { page, limit } = req.query;
        const pagination = getPagination(page, limit);

        const where = {
            property: { ownerId: req.user.id },
            status: { in: ['CONFIRMED', 'ONGOING', 'COMPLETED'] }
        };

        const [rows, total] = await Promise.all([
            prisma.booking.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { createdAt: 'desc' },
                include: {
                    property: { select: { propertyName: true } },
                    payments: {
                        orderBy: { createdAt: 'asc' }
                    }
                }
            }),
            prisma.booking.count({ where }),
        ]);

        const formattedRows = rows.map(b => {
            const payments = b.payments || [];
            const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
            const status = totalPaid >= b.totalAmount ? 'PAID' : (totalPaid > 0 ? 'PARTIAL' : 'PENDING');
            
            return {
                id: b.id, 
                amount: b.totalAmount,
                currency: payments.length > 0 ? payments[0].currency : 'USD',
                status: status, 
                method: payments.length > 0 ? payments[payments.length - 1].paymentMethod : 'Offline',
                requestedAt: b.createdAt,
                paidAt: payments.length > 0 ? payments[payments.length - 1].paidAt : null,
                propertyName: b.property.propertyName,
                guestEmail: b.guestEmail,
                totalPaid,
                payments
            };
        });

        res.json({
            success: true,
            ...formatPaginatedResponse(formattedRows, total, pagination.page, pagination.limit),
        });
    } catch (error) {
        console.error('Get booking payments history error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch payments history.' });
    }
};

const logPayment = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { amount, paymentMethod, paidAt } = req.body;
        const ownerId = req.user.id;

        const booking = await prisma.booking.findFirst({
            where: { id: bookingId, property: { ownerId } },
            include: { property: true }
        });

        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found.' });
        }

        const parsedAmount = parseFloat(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'A valid payment amount greater than 0 is required.',
            });
        }

        const payment = await prisma.bookingPayment.create({
            data: {
                bookingId,
                amount: parsedAmount,
                status: 'PAID',
                paymentMethod: paymentMethod || 'Offline',
                paidAt: paidAt ? new Date(paidAt) : new Date()
            }
        });

        const allPayments = await prisma.bookingPayment.findMany({ where: { bookingId } });
        const totalPaid = allPayments.reduce((sum, p) => sum + p.amount, 0);
        const balance = booking.totalAmount - totalPaid;

        if (booking.guestEmail) {
            const { sendPaymentConfirmationEmail, sendInvoiceEmail } = require('../services/email.service');
            try {
                await sendPaymentConfirmationEmail(booking.guestEmail, booking, payment, totalPaid, balance);
                if (balance <= 0) {
                    await sendInvoiceEmail(booking.guestEmail, booking, allPayments);
                }
            } catch (err) {
                console.error('Failed to send payment email', err);
            }
        }

        res.json({
            success: true,
            message: 'Payment logged successfully.',
            data: payment
        });
    } catch (error) {
        console.error('Log payment error:', error);
        res.status(500).json({ success: false, message: 'Failed to log payment.' });
    }
};

const deletePayment = async (req, res) => {
    try {
        const { paymentId } = req.params;
        const ownerId = req.user.id;

        const payment = await prisma.bookingPayment.findUnique({
            where: { id: paymentId },
            include: { booking: { include: { property: true } } }
        });

        if (!payment || payment.booking.property.ownerId !== ownerId) {
            return res.status(404).json({ success: false, message: 'Payment not found or access denied.' });
        }

        await prisma.bookingPayment.delete({ where: { id: paymentId } });

        res.json({ success: true, message: 'Payment deleted successfully.' });
    } catch (error) {
        console.error('Delete payment error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete payment.' });
    }
};

const getAllPayouts = async (req, res) => {
    res.json({ success: true, data: [], meta: { total: 0 } });
};

const processPayout = async (req, res) => {
    res.json({ success: false, message: 'Not applicable' });
};

const requestPayout = async (req, res) => {
    res.status(400).json({ success: false, message: 'Please use the new offline payments ledger to mark bookings as paid.' });
};

module.exports = {
    getEarningsSummary,
    getPayoutHistory,
    logPayment,
    deletePayment,
    requestPayout,
    getAllPayouts,
    processPayout
};
