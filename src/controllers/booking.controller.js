const prisma = require('../config/database');

/**
 * Check property availability for given dates
 * POST /bookings/check-availability
 */
const checkAvailability = async (req, res) => {
    try {
        const { propertyId, checkin, checkout } = req.body;

        // Validate inputs
        if (!propertyId || !checkin || !checkout) {
            return res.status(400).json({
                success: false,
                message: 'Property ID, check-in, and check-out dates are required.',
            });
        }

        const checkinDate = new Date(checkin);
        const checkoutDate = new Date(checkout);

        // Validate dates
        if (checkinDate >= checkoutDate) {
            return res.status(400).json({
                success: false,
                message: 'Check-out date must be after check-in date.',
            });
        }

        if (checkinDate < new Date()) {
            return res.status(400).json({
                success: false,
                message: 'Check-in date cannot be in the past.',
            });
        }

        // Get property
        const property = await prisma.property.findFirst({
            where: {
                OR: [{ id: propertyId }, { propertyId }],
            },
        });

        if (!property) {
            return res.status(404).json({
                success: false,
                message: 'Property not found.',
            });
        }

        // Check for conflicting bookings
        const conflictingBooking = await prisma.booking.findFirst({
            where: {
                propertyId: property.id,
                status: 'CONFIRMED',
                OR: [
                    // New booking starts during existing booking
                    {
                        checkin: { lte: checkinDate },
                        checkout: { gt: checkinDate },
                    },
                    // New booking ends during existing booking
                    {
                        checkin: { lt: checkoutDate },
                        checkout: { gte: checkoutDate },
                    },
                    // New booking completely contains existing booking
                    {
                        checkin: { gte: checkinDate },
                        checkout: { lte: checkoutDate },
                    },
                ],
            },
        });

        // Calculate nights and pricing
        const nights = Math.ceil((checkoutDate - checkinDate) / (1000 * 60 * 60 * 24));
        const nightlyRate = property.nightlyRate || property.minRate || 0;
        const totalAmount = nights * nightlyRate;

        // Get all blocked dates for this property
        const existingBookings = await prisma.booking.findMany({
            where: {
                propertyId: property.id,
                status: 'CONFIRMED',
                checkout: { gte: new Date() },
            },
            select: {
                checkin: true,
                checkout: true,
            },
            orderBy: {
                checkin: 'asc',
            },
        });

        const blockedDates = existingBookings.map(b => ({
            start: b.checkin,
            end: b.checkout,
        }));

        if (conflictingBooking) {
            return res.status(200).json({
                success: false,
                available: false,
                message: 'Property is not available for the selected dates.',
                blockedDates,
            });
        }

        res.json({
            success: true,
            available: true,
            message: 'Property is available for booking.',
            data: {
                propertyId: property.id,
                propertyName: property.propertyName,
                checkin: checkinDate,
                checkout: checkoutDate,
                nights,
                nightlyRate,
                totalAmount,
                blockedDates,
            },
        });
    } catch (error) {
        console.error('Check availability error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check availability.',
            error: error.message,
        });
    }
};

/**
 * Create a new booking (instant reservation)
 * POST /bookings/create
 */
const createBooking = async (req, res) => {
    try {
        const {
            propertyId,
            guestName,
            guestEmail,
            guestPhone,
            checkin,
            checkout,
            guests,
            notes,
        } = req.body;

        // Validate required fields
        if (!propertyId || !guestName || !guestEmail || !checkin || !checkout) {
            return res.status(400).json({
                success: false,
                message: 'Property ID, guest name, email, check-in, and check-out are required.',
            });
        }

        const checkinDate = new Date(checkin);
        const checkoutDate = new Date(checkout);

        // Validate dates
        if (checkinDate >= checkoutDate) {
            return res.status(400).json({
                success: false,
                message: 'Check-out date must be after check-in date.',
            });
        }

        if (checkinDate < new Date()) {
            return res.status(400).json({
                success: false,
                message: 'Check-in date cannot be in the past.',
            });
        }

        // Get property
        const property = await prisma.property.findFirst({
            where: {
                OR: [{ id: propertyId }, { propertyId }],
            },
            include: {
                owner: {
                    select: { email: true, firstName: true, lastName: true },
                },
            },
        });

        if (!property) {
            return res.status(404).json({
                success: false,
                message: 'Property not found.',
            });
        }

        // Double-check availability (prevent race conditions)
        const conflictingBooking = await prisma.booking.findFirst({
            where: {
                propertyId: property.id,
                status: 'CONFIRMED',
                OR: [
                    {
                        checkin: { lte: checkinDate },
                        checkout: { gt: checkinDate },
                    },
                    {
                        checkin: { lt: checkoutDate },
                        checkout: { gte: checkoutDate },
                    },
                    {
                        checkin: { gte: checkinDate },
                        checkout: { lte: checkoutDate },
                    },
                ],
            },
        });

        if (conflictingBooking) {
            return res.status(409).json({
                success: false,
                message: 'Property is no longer available for the selected dates.',
            });
        }

        // Calculate booking details
        const nights = Math.ceil((checkoutDate - checkinDate) / (1000 * 60 * 60 * 24));
        const nightlyRate = property.nightlyRate || property.minRate || 0;
        const totalAmount = nights * nightlyRate;

        // Create booking
        const booking = await prisma.booking.create({
            data: {
                propertyId: property.id,
                guestName,
                guestEmail,
                guestPhone,
                checkin: checkinDate,
                checkout: checkoutDate,
                guests: parseInt(guests) || 1,
                nights,
                nightlyRate,
                totalAmount,
                notes,
                status: 'CONFIRMED',
            },
        });

        res.status(201).json({
            success: true,
            message: 'Booking confirmed successfully!',
            data: {
                bookingId: booking.bookingId,
                id: booking.id,
                propertyName: property.propertyName,
                propertyLocation: property.location,
                guestName: booking.guestName,
                guestEmail: booking.guestEmail,
                checkin: booking.checkin,
                checkout: booking.checkout,
                guests: booking.guests,
                nights: booking.nights,
                nightlyRate: booking.nightlyRate,
                totalAmount: booking.totalAmount,
                status: booking.status,
                createdAt: booking.createdAt,
            },
        });
    } catch (error) {
        console.error('Create booking error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create booking.',
            error: error.message,
        });
    }
};

/**
 * Get booking by ID
 * GET /bookings/:id
 */
const getBookingById = async (req, res) => {
    try {
        const { id } = req.params;

        const booking = await prisma.booking.findFirst({
            where: {
                OR: [{ id }, { bookingId: id }],
            },
            include: {
                property: {
                    select: {
                        propertyName: true,
                        location: true,
                        state: true,
                        country: true,
                        images: true,
                        amenities: true,
                        owner: {
                            select: {
                                firstName: true,
                                lastName: true,
                                email: true,
                                phoneNumber: true,
                            },
                        },
                    },
                },
            },
        });

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: 'Booking not found.',
            });
        }

        res.json({
            success: true,
            data: {
                bookingId: booking.bookingId,
                id: booking.id,
                guestName: booking.guestName,
                guestEmail: booking.guestEmail,
                guestPhone: booking.guestPhone,
                checkin: booking.checkin,
                checkout: booking.checkout,
                guests: booking.guests,
                nights: booking.nights,
                nightlyRate: booking.nightlyRate,
                totalAmount: booking.totalAmount,
                status: booking.status,
                notes: booking.notes,
                createdAt: booking.createdAt,
                property: {
                    propertyName: booking.property.propertyName,
                    location: booking.property.location,
                    state: booking.property.state,
                    country: booking.property.country,
                    images: booking.property.images,
                    amenities: booking.property.amenities,
                    owner: booking.property.owner,
                },
            },
        });
    } catch (error) {
        console.error('Get booking error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch booking.',
        });
    }
};

/**
 * Get all bookings for a property (Owner/Admin only)
 * GET /bookings/property/:propertyId
 */
const getPropertyBookings = async (req, res) => {
    try {
        const { propertyId } = req.params;

        // Get property and verify ownership
        const property = await prisma.property.findFirst({
            where: {
                OR: [{ id: propertyId }, { propertyId }],
            },
        });

        if (!property) {
            return res.status(404).json({
                success: false,
                message: 'Property not found.',
            });
        }

        // Check authorization
        if (req.user.role !== 'ADMIN' && property.ownerId !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        const bookings = await prisma.booking.findMany({
            where: {
                propertyId: property.id,
            },
            orderBy: {
                checkin: 'desc',
            },
        });

        res.json({
            success: true,
            data: bookings,
        });
    } catch (error) {
        console.error('Get property bookings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch bookings.',
        });
    }
};

/**
 * Cancel a booking
 * PATCH /bookings/:id/cancel
 */
const cancelBooking = async (req, res) => {
    try {
        const { id } = req.params;

        const booking = await prisma.booking.findFirst({
            where: {
                OR: [{ id }, { bookingId: id }],
            },
        });

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: 'Booking not found.',
            });
        }

        if (booking.status === 'CANCELLED') {
            return res.status(400).json({
                success: false,
                message: 'Booking is already cancelled.',
            });
        }

        const updatedBooking = await prisma.booking.update({
            where: { id: booking.id },
            data: { status: 'CANCELLED' },
        });

        res.json({
            success: true,
            message: 'Booking cancelled successfully.',
            data: updatedBooking,
        });
    } catch (error) {
        console.error('Cancel booking error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to cancel booking.',
        });
    }
};

/**
 * Get all owner orders (bookings globally across all owner properties)
 * GET /bookings/owner/orders
 */
const getOwnerBookingsGlobal = async (req, res) => {
    try {
        const ownerId = req.user.id; // From authenticate middleware

        const bookings = await prisma.booking.findMany({
            where: {
                property: {
                    ownerId: ownerId,
                },
            },
            include: {
                property: {
                    select: {
                        propertyName: true,
                        location: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        res.json({
            success: true,
            data: bookings,
        });
    } catch (error) {
        console.error('Get global owner bookings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch global bookings.',
        });
    }
};

module.exports = {
    checkAvailability,
    createBooking,
    getBookingById,
    getPropertyBookings,
    getOwnerBookingsGlobal,
    cancelBooking,
};
