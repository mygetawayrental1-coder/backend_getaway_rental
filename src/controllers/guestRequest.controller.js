const { Prisma } = require('@prisma/client');
const prisma = require('../config/database');
const { getPagination, formatPaginatedResponse } = require('../utils/helpers');
const { verifyCaptcha } = require('./captcha.controller');
const {
    sendGuestRequestNotification,
    sendGuestRequestConfirmationToGuest,
    sendGuestRequestAcceptedToGuest,
    sendGuestRequestRejectedToGuest,
} = require('../services/email.service');
const {
    createTypedNotification,
    NOTIFICATION_TYPES,
} = require('../services/notification.service');
const {
    utcStartOfDay,
    calculateNights,
    calculateStayQuote,
    findStayConflicts,
    hasConflicts,
    conflictMessage,
} = require('../utils/stayAvailability');
const icalService = require('../services/ical.service');
const { getCheckoutConfig } = require('./checkoutField.controller');

const PENDING_REQUEST_STATUSES = ['NEW', 'VIEWED', 'CONTACTED'];

function startOfDay(value) {
    return utcStartOfDay(value);
}

const TEMP_QUOTE_NOTE =
    'This is a temporary estimate and can change after discussions with the owner.';

function formatUsd(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return null;
    return `$${n.toFixed(2)}`;
}

function parseNonNegInt(value, fallback = 0) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
}

/** Normalize adults / children / pets; guests = adults + children. */
function normalizeGuestParty(body = {}) {
    let adults = body.adults != null ? parseNonNegInt(body.adults, 1) : null;
    let children = body.children != null ? parseNonNegInt(body.children, 0) : null;
    let pets = body.pets != null ? parseNonNegInt(body.pets, 0) : null;
    const guestsFallback = Math.max(1, parseNonNegInt(body.guests, 1));

    if (adults == null && children == null) {
        adults = guestsFallback;
        children = 0;
    } else {
        adults = adults == null ? Math.max(1, guestsFallback) : adults;
        children = children == null ? 0 : children;
    }
    if (adults < 1 && children < 1) adults = 1;
    pets = pets == null ? 0 : pets;

    return {
        adults,
        children,
        pets,
        guests: Math.max(1, adults + children),
    };
}

function parseCustomFieldsPayload(raw, activeDefs) {
    let incoming = raw;
    if (typeof raw === 'string') {
        try {
            incoming = JSON.parse(raw);
        } catch {
            incoming = {};
        }
    }
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        incoming = {};
    }

    const cleaned = {};
    const labels = {};
    for (const def of activeDefs || []) {
        const key = def.name;
        const val = incoming[key];
        if (val === undefined || val === null) continue;
        if (typeof val === 'boolean') {
            cleaned[key] = val;
        } else {
            const s = String(val).trim();
            if (s === '') continue;
            cleaned[key] = s;
        }
        labels[key] = def.label || key;
    }
    return { cleaned, labels };
}

function emailPayload(request, property, quote = {}, customFieldLabels = {}) {
    let customFields = request.customFields;
    if (typeof customFields === 'string') {
        try {
            customFields = JSON.parse(customFields);
        } catch {
            customFields = {};
        }
    }
    return {
        propertyName: property.propertyName,
        fullName: request.fullName,
        email: request.email,
        phone: request.phone,
        checkin: request.checkin,
        checkout: request.checkout,
        guests: request.guests,
        adults: request.adults,
        children: request.children,
        pets: request.pets,
        message: request.message,
        customFields: customFields && typeof customFields === 'object' ? customFields : {},
        customFieldLabels,
        nights: quote.nights ?? null,
        quotedNightlyRate: quote.quotedNightlyRate ?? null,
        quotedSubtotal: quote.quotedSubtotal ?? null,
        quotedServiceFee: quote.quotedServiceFee ?? null,
        quotedDynamicFees: quote.quotedDynamicFees ?? null,
        quotedTotal: quote.quotedTotal ?? null,
        quoteNote: TEMP_QUOTE_NOTE,
        ownerPhone: property.owner?.phoneNumber
            ? `${property.owner.countryCode || ''} ${property.owner.phoneNumber}`.trim()
            : null,
    };
}

// Create guest request (PUBLIC - no auth required)
const createGuestRequest = async (req, res) => {
    try {
        const {
            propertyId,
            fullName,
            email,
            phone,
            message,
            checkin,
            checkout,
            guests,
            adults,
            children,
            pets,
            nights,
            quotedNightlyRate,
            quotedSubtotal,
            quotedServiceFee,
            quotedDynamicFees,
            quotedTotal,
            customFields: customFieldsRaw,
            captchaId,
            captchaCode,
        } = req.body;

        const party = normalizeGuestParty({ guests, adults, children, pets });

        if (!(await verifyCaptcha(captchaId, captchaCode))) {
            return res.status(400).json({ success: false, message: 'Invalid or expired security code.' });
        }

        const guestEmail = String(email || '').trim();
        const guestName = String(fullName || '').trim();

        if (!propertyId || !guestName || !guestEmail) {
            return res.status(400).json({
                success: false,
                message: 'Property, full name, and email are required.',
            });
        }

        let checkoutConfig;
        try {
            checkoutConfig = await getCheckoutConfig();
        } catch {
            checkoutConfig = {
                fields: [],
                hiddenStandards: [],
                requiredStandards: [],
                standardLabels: {},
            };
        }

        const hidden = new Set(checkoutConfig.hiddenStandards || []);
        const requiredStd = new Set(checkoutConfig.requiredStandards || []);
        // Safety floor: name + email always required (already checked)
        if (!hidden.has('phone') && requiredStd.has('phone') && !String(phone || '').trim()) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required.',
            });
        }
        if (!hidden.has('message') && requiredStd.has('message') && !String(message || '').trim()) {
            return res.status(400).json({
                success: false,
                message: 'Message is required.',
            });
        }

        const { cleaned: customFieldsClean, labels: customFieldLabels } = parseCustomFieldsPayload(
            customFieldsRaw,
            checkoutConfig.fields || [],
        );
        for (const def of checkoutConfig.fields || []) {
            if (!def.required) continue;
            const val = customFieldsClean[def.name];
            if (val === undefined || val === null || String(val).trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: `${def.label || def.name} is required.`,
                });
            }
        }

        const property = await prisma.property.findFirst({
            where: { OR: [{ id: propertyId }, { propertyId }] },
            include: {
                owner: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        phoneNumber: true,
                        countryCode: true,
                    },
                },
                seasonalPrices: {
                    where: { isActive: true },
                    orderBy: { startDate: 'asc' },
                },
            },
        });

        if (!property) {
            return res.status(404).json({
                success: false,
                message: 'Property not found.',
            });
        }

        if (!property.owner?.email) {
            return res.status(400).json({
                success: false,
                message: 'This property has no owner email on file. Please contact support.',
            });
        }

        if (checkin && checkout) {
            const conflicts = await findStayConflicts(property.id, checkin, checkout);
            if (hasConflicts(conflicts)) {
                return res.status(409).json({
                    success: false,
                    message: conflictMessage(conflicts),
                    conflicts,
                });
            }
        }

        const maxGuests = Number(property.guests) || 0;
        if (maxGuests > 0 && party.guests > maxGuests) {
            return res.status(400).json({
                success: false,
                message: `This property allows up to ${maxGuests} guests (adults + children).`,
            });
        }

        // Prefer server-side seasonal quote so email estimates match booking math.
        let quote = {
            nights: Number.isFinite(Number(nights)) ? Number(nights) : null,
            quotedNightlyRate: Number.isFinite(Number(quotedNightlyRate))
                ? Number(quotedNightlyRate)
                : null,
            quotedSubtotal: Number.isFinite(Number(quotedSubtotal))
                ? Number(quotedSubtotal)
                : null,
            quotedServiceFee: Number.isFinite(Number(quotedServiceFee))
                ? Number(quotedServiceFee)
                : null,
            quotedDynamicFees: Number.isFinite(Number(quotedDynamicFees))
                ? Number(quotedDynamicFees)
                : null,
            quotedTotal: Number.isFinite(Number(quotedTotal)) ? Number(quotedTotal) : null,
        };
        if (checkin && checkout) {
            const stayQuote = calculateStayQuote({
                checkin,
                checkout,
                nightlyRate: property.nightlyRate,
                weekendRate: property.weekendRate,
                seasons: property.seasonalPrices || [],
            });
            if (stayQuote.nights > 0) {
                const fees =
                    (Number(quote.quotedServiceFee) || 0) +
                    (Number(quote.quotedDynamicFees) || 0);
                quote = {
                    ...quote,
                    nights: stayQuote.nights,
                    quotedNightlyRate: Math.round(stayQuote.subtotal / stayQuote.nights),
                    quotedSubtotal: stayQuote.subtotal,
                    quotedTotal: stayQuote.subtotal + fees,
                };
            }
        }

        const quoteLines = [];
        quoteLines.push(
            `Guests: ${party.guests} (Adults: ${party.adults}, Children: ${party.children}, Pets: ${party.pets})`,
        );
        for (const [key, val] of Object.entries(customFieldsClean)) {
            const label = customFieldLabels[key] || key;
            quoteLines.push(`${label}: ${typeof val === 'boolean' ? (val ? 'Yes' : 'No') : val}`);
        }
        if (quote.nights != null) quoteLines.push(`Nights: ${quote.nights}`);
        if (formatUsd(quote.quotedNightlyRate)) {
            quoteLines.push(`Nightly rate: ${formatUsd(quote.quotedNightlyRate)}`);
        }
        if (formatUsd(quote.quotedSubtotal)) {
            quoteLines.push(`Subtotal: ${formatUsd(quote.quotedSubtotal)}`);
        }
        if (formatUsd(quote.quotedServiceFee)) {
            quoteLines.push(`Fees: ${formatUsd(quote.quotedServiceFee)}`);
        }
        if (formatUsd(quote.quotedDynamicFees) && quote.quotedDynamicFees > 0) {
            quoteLines.push(`Other fees: ${formatUsd(quote.quotedDynamicFees)}`);
        }
        if (formatUsd(quote.quotedTotal)) {
            quoteLines.push(`Quoted total: ${formatUsd(quote.quotedTotal)}`);
        }
        const baseMessage = String(message || '').trim();
        const messageWithQuote =
            quoteLines.length > 0
                ? [
                      baseMessage,
                      '',
                      '--- Price estimate ---',
                      ...quoteLines,
                      TEMP_QUOTE_NOTE,
                  ]
                      .filter((line, idx, arr) => !(idx === 0 && line === ''))
                      .join('\n')
                      .trim()
                : baseMessage || null;

        const guestRequest = await prisma.guestRequest.create({
            data: {
                propertyId: property.id,
                fullName: guestName,
                email: guestEmail,
                phone,
                message: messageWithQuote,
                checkin: checkin ? new Date(checkin) : null,
                checkout: checkout ? new Date(checkout) : null,
                guests: party.guests,
                adults: party.adults,
                children: party.children,
                pets: party.pets,
                customFields:
                    Object.keys(customFieldsClean).length > 0
                        ? JSON.stringify(customFieldsClean)
                        : null,
                status: 'NEW',
            },
            include: {
                property: {
                    select: { propertyName: true, location: true },
                },
            },
        });

        const mailData = emailPayload(guestRequest, property, quote, customFieldLabels);

        // Await both emails (in parallel) before responding — fire-and-forget after res.json()
        // was dropping the guest confirmation when the request lifecycle ended early.
        const [ownerMail, guestMail] = await Promise.allSettled([
            sendGuestRequestNotification(property.owner.email, mailData),
            sendGuestRequestConfirmationToGuest(guestEmail, mailData),
        ]);

        if (ownerMail.status === 'rejected') {
            console.error(
                'Owner email failed:',
                ownerMail.reason?.message || ownerMail.reason,
                '| to:',
                property.owner.email,
            );
        } else {
            console.log('Owner rent-request email sent | to:', property.owner.email);
        }

        if (guestMail.status === 'rejected') {
            console.error(
                'Guest confirmation email failed:',
                guestMail.reason?.message || guestMail.reason,
                '| to:',
                guestEmail,
            );
        } else {
            console.log('Guest confirmation email sent | to:', guestEmail);
        }

        try {
            await createTypedNotification({
                userId: property.owner.id,
                type: NOTIFICATION_TYPES.GUEST_REQUEST_NEW,
                data: {
                    guestRequestId: guestRequest.id,
                    propertyId: property.id,
                    propertyName: property.propertyName,
                },
                vars: {
                    propertyName: property.propertyName,
                    guestName,
                },
            });
        } catch (notifyErr) {
            console.error('Owner dashboard notification failed:', notifyErr.message);
        }

        res.status(201).json({
            success: true,
            message:
                'Your request was submitted. Check your email for confirmation — the owner will respond soon.',
            data: guestRequest,
        });
    } catch (error) {
        console.error('Create guest request error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit request.',
        });
    }
};

const getOwnerGuestRequests = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page, limit, status, propertyId } = req.query;
        const pagination = getPagination(page, limit);

        const ownerProperties = await prisma.property.findMany({
            where: { ownerId: userId },
            select: { id: true },
        });

        const propertyIds = ownerProperties.map((p) => p.id);

        if (propertyIds.length === 0) {
            return res.json({
                success: true,
                ...formatPaginatedResponse([], 0, pagination.page, pagination.limit),
                message: 'No properties found for this owner.',
            });
        }

        const where = {
            propertyId: { in: propertyIds },
        };

        if (status) {
            where.status = status;
        }

        if (propertyId && propertyIds.includes(propertyId)) {
            where.propertyId = propertyId;
        }

        const [requests, total] = await Promise.all([
            prisma.guestRequest.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { createdAt: 'desc' },
                include: {
                    property: {
                        select: { propertyName: true, location: true, images: true },
                    },
                },
            }),
            prisma.guestRequest.count({ where }),
        ]);

        res.json({
            success: true,
            ...formatPaginatedResponse(requests, total, pagination.page, pagination.limit),
        });
    } catch (error) {
        console.error('Get owner guest requests error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch guest requests.',
        });
    }
};

const getGuestRequestById = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const request = await prisma.guestRequest.findUnique({
            where: { id },
            include: {
                property: {
                    include: {
                        owner: {
                            select: { id: true },
                        },
                    },
                },
            },
        });

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Guest request not found.',
            });
        }

        if (req.user.role !== 'ADMIN' && request.property.owner.id !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        res.json({
            success: true,
            data: request,
        });
    } catch (error) {
        console.error('Get guest request error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch guest request.',
        });
    }
};

const updateGuestRequestStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const userId = req.user.id;

        const validStatuses = [
            'NEW',
            'VIEWED',
            'CONTACTED',
            'ACCEPTED',
            'REJECTED',
            'CLOSED',
        ];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
            });
        }

        const request = await prisma.guestRequest.findUnique({
            where: { id },
            include: {
                property: {
                    select: {
                        propertyName: true,
                        nightlyRate: true,
                        weekendRate: true,
                        seasonalPrices: {
                            where: { isActive: true },
                            orderBy: { startDate: 'asc' },
                        },
                        owner: {
                            select: {
                                id: true,
                                email: true,
                                firstName: true,
                                lastName: true,
                                paymentInstructions: true,
                            },
                        },
                    },
                },
            },
        });

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Guest request not found.',
            });
        }

        if (req.user.role !== 'ADMIN' && request.property.owner.id !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        const previousStatus = request.status;
        let updated;

        const mailData = {
            propertyName: request.property.propertyName,
            fullName: request.fullName,
            email: request.email,
            phone: request.phone,
            checkin: request.checkin,
            checkout: request.checkout,
            guests: request.guests,
            adults: request.adults,
            children: request.children,
            pets: request.pets,
            message: request.message,
        };

        if (status === 'ACCEPTED' && previousStatus !== 'ACCEPTED') {
            if (!request.checkin || !request.checkout) {
                return res.status(400).json({
                    success: false,
                    message: 'This request has no stay dates, so it cannot be accepted as a booking.',
                });
            }

            const checkin = startOfDay(request.checkin);
            const checkout = startOfDay(request.checkout);
            const nightlyRate = request.property.nightlyRate || 0;
            const weekendRate = request.property.weekendRate || null;
            const quote = calculateStayQuote({
                checkin,
                checkout,
                nightlyRate,
                weekendRate,
                seasons: request.property.seasonalPrices || [],
            });
            const nights = Math.max(1, quote.nights || calculateNights(checkin, checkout));
            const totalAmount = quote.subtotal;

            try {
                const txResult = await prisma.$transaction(async (tx) => {
                    const conflicts = await findStayConflicts(
                        request.propertyId,
                        checkin,
                        checkout,
                        { excludeRequestId: request.id, tx },
                    );
                    if (hasConflicts(conflicts)) {
                        return { conflict: conflicts };
                    }

                    const reqRow = await tx.guestRequest.update({
                        where: { id },
                        data: { status },
                    });

                    const booking = await tx.booking.create({
                        data: {
                            propertyId: request.propertyId,
                            guestName: request.fullName,
                            guestEmail: request.email,
                            guestPhone: request.phone,
                            checkin,
                            checkout,
                            guests: request.guests,
                            adults: request.adults ?? Math.max(1, request.guests || 1),
                            children: request.children ?? 0,
                            pets: request.pets ?? 0,
                            nights,
                            nightlyRate,
                            weekendRate,
                            totalAmount,
                            status: 'CONFIRMED',
                            confirmedAt: new Date(),
                        },
                    });

                    return { reqRow, booking };
                }, {
                    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                    maxWait: 5000,
                    timeout: 15000,
                });

                if (txResult.conflict) {
                    return res.status(409).json({
                        success: false,
                        message: conflictMessage(txResult.conflict),
                        conflicts: txResult.conflict,
                    });
                }

                updated = txResult.reqRow;

                try {
                    await icalService.createEventForInternalBooking({
                        id: txResult.booking.id,
                        propertyId: txResult.booking.propertyId,
                        checkin: txResult.booking.checkin,
                        checkout: txResult.booking.checkout,
                    });
                } catch (icalErr) {
                    console.error('Failed to sync accepted request booking to iCal:', icalErr.message);
                }

                const overlappingPending = await prisma.guestRequest.findMany({
                    where: {
                        propertyId: request.propertyId,
                        id: { not: request.id },
                        status: { in: PENDING_REQUEST_STATUSES },
                        AND: [
                            { checkin: { not: null } },
                            { checkout: { not: null } },
                            { checkin: { lt: checkout } },
                            { checkout: { gt: checkin } },
                        ],
                    },
                });

                if (overlappingPending.length > 0) {
                    await prisma.guestRequest.updateMany({
                        where: { id: { in: overlappingPending.map((r) => r.id) } },
                        data: { status: 'REJECTED' },
                    });

                    for (const pending of overlappingPending) {
                        try {
                            await sendGuestRequestRejectedToGuest(pending.email, {
                                propertyName: request.property.propertyName,
                                fullName: pending.fullName,
                                email: pending.email,
                                phone: pending.phone,
                                checkin: pending.checkin,
                                checkout: pending.checkout,
                                guests: pending.guests,
                                adults: pending.adults,
                                children: pending.children,
                                pets: pending.pets,
                                message: pending.message,
                            });
                        } catch (emailError) {
                            console.error('Auto-reject email failed:', emailError.message);
                        }
                    }
                }

                try {
                    await sendGuestRequestAcceptedToGuest(
                        request.email,
                        mailData,
                        request.property.owner,
                    );
                } catch (emailError) {
                    console.error('Acceptance email failed:', emailError.message);
                }
            } catch (bookingErr) {
                if (bookingErr.code === 'P2034') {
                    return res.status(409).json({
                        success: false,
                        message: 'Could not accept due to a conflict. Please try again.',
                    });
                }
                console.error('Failed to create booking from guest request:', bookingErr.message);
                return res.status(500).json({
                    success: false,
                    message: 'Could not block these dates as a booking. Request was not accepted.',
                });
            }
        } else {
            updated = await prisma.guestRequest.update({
                where: { id },
                data: { status },
            });
        }

        if (status === 'REJECTED' && previousStatus !== 'REJECTED') {
            try {
                await sendGuestRequestRejectedToGuest(request.email, mailData);
            } catch (emailError) {
                console.error('Rejection email failed:', emailError.message);
            }
        }

        res.json({
            success: true,
            message:
                status === 'ACCEPTED'
                    ? 'Request accepted. Overlapping pending requests were declined automatically.'
                    : 'Status updated successfully.',
            data: updated,
        });
    } catch (error) {
        console.error('Update guest request status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update status.',
        });
    }
};

const deleteGuestRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const request = await prisma.guestRequest.findUnique({
            where: { id },
            include: {
                property: {
                    include: {
                        owner: { select: { id: true } },
                    },
                },
            },
        });

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Guest request not found.',
            });
        }

        if (req.user.role !== 'ADMIN' && request.property.owner.id !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        await prisma.guestRequest.delete({ where: { id } });

        res.json({
            success: true,
            message: 'Guest request deleted successfully.',
        });
    } catch (error) {
        console.error('Delete guest request error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete guest request.',
        });
    }
};

module.exports = {
    createGuestRequest,
    getOwnerGuestRequests,
    getGuestRequestById,
    updateGuestRequestStatus,
    deleteGuestRequest,
};
