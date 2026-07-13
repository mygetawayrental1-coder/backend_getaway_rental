const prisma = require('../config/database');
const { getSubscriptionSummary } = require('../services/subscriptionAccess.service');

function primaryEmailFromClerk(data) {
    if (!data?.email_addresses?.length) return null;
    const primaryId = data.primary_email_address_id;
    if (primaryId) {
        const match = data.email_addresses.find((e) => e.id === primaryId);
        if (match?.email_address) return match.email_address;
    }
    return data.email_addresses[0].email_address;
}

/**
 * Upsert a Prisma user from Clerk webhook / sync payload.
 * Links existing accounts by email when clerkId is new.
 */
const syncUser = async (clerkData) => {
    const clerkId = clerkData?.id;
    const email = primaryEmailFromClerk(clerkData);

    if (!clerkId || !email) {
        throw new Error('Clerk user payload must include id and a primary email.');
    }

    const profile = {
        email,
        firstName: clerkData.first_name || '',
        lastName: clerkData.last_name || '',
        profilePic: clerkData.image_url || null,
        isActive: true,
    };

    const byClerk = await prisma.user.findUnique({ where: { clerkId } });
    if (byClerk) {
        const rolePatch =
            byClerk.role === 'END_USER' || byClerk.role === 'OWNER'
                ? { role: 'OWNER' }
                : {};
        return prisma.user.update({
            where: { clerkId },
            data: { ...profile, ...rolePatch },
        });
    }

    const byEmail = await prisma.user.findUnique({ where: { email } });
    if (byEmail) {
        const rolePatch =
            byEmail.role === 'END_USER' || byEmail.role === 'OWNER'
                ? { role: 'OWNER' }
                : {};
        return prisma.user.update({
            where: { email },
            data: { ...profile, clerkId, ...rolePatch },
        });
    }

    return prisma.user.create({
        data: {
            clerkId,
            ...profile,
            role: 'OWNER',
        },
    });
};

/** Soft-deactivate user when deleted in Clerk. */
const deactivateUserByClerkId = async (clerkId) => {
    if (!clerkId) return { count: 0 };
    return prisma.user.updateMany({
        where: { clerkId },
        data: { isActive: false },
    });
};

/** Ensure Prisma user exists for the Clerk account in the Bearer token. */
const syncMe = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
            },
        });

        res.json({
            success: true,
            data: user,
        });
    } catch (error) {
        console.error('Sync me error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to sync profile.',
        });
    }
};

const getMe = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: {
                id: true,
                clerkId: true,
                email: true,
                firstName: true,
                lastName: true,
                countryCode: true,
                phoneNumber: true,
                address: true,
                profilePic: true,
                about: true,
                role: true,
                isActive: true,
                createdAt: true,
            },
        });

        const subscription = await getSubscriptionSummary(user.id);

        res.json({
            success: true,
            data: {
                ...user,
                role: user.role === 'END_USER' ? 'OWNER' : user.role,
                ...subscription,
            },
        });
    } catch (error) {
        console.error('Get me error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch profile.',
        });
    }
};

/** Update Prisma profile fields (Clerk profile is managed on the client). */
const editProfile = async (req, res) => {
    try {
        const { email } = req.query;
        const userId = req.user.id;
        const { firstName, lastName, countryCode, phoneNumber, address, profilePic, about } = req.body;

        const targetUser = email ? await prisma.user.findUnique({ where: { email } }) : null;

        if (email && !targetUser) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const idToUpdate = targetUser ? targetUser.id : userId;

        if (req.user.role !== 'ADMIN' && idToUpdate !== userId) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const updateData = {};
        if (firstName !== undefined) updateData.firstName = firstName;
        if (lastName !== undefined) updateData.lastName = lastName;
        if (countryCode !== undefined) updateData.countryCode = countryCode;
        if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
        if (address !== undefined) updateData.address = address;
        if (req.file) {
            const { multerFileToPublicPath } = require('../config/storage');
            updateData.profilePic = multerFileToPublicPath(req.file);
        } else if (profilePic !== undefined) {
            updateData.profilePic = profilePic;
        }
        if (about !== undefined) updateData.about = about;

        const user = await prisma.user.update({
            where: { id: idToUpdate },
            data: updateData,
            select: {
                id: true,
                clerkId: true,
                email: true,
                firstName: true,
                lastName: true,
                countryCode: true,
                phoneNumber: true,
                address: true,
                profilePic: true,
                about: true,
                role: true,
                isActive: true,
            },
        });

        res.json({
            success: true,
            message: 'Profile updated successfully.',
            data: user,
        });
    } catch (error) {
        console.error('Edit profile error:', error);
        res.status(500).json({ success: false, message: 'Failed to update profile.' });
    }
};

module.exports = {
    syncUser,
    deactivateUserByClerkId,
    syncMe,
    getMe,
    editProfile,
};
