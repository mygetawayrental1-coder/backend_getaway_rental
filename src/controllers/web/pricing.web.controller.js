const prisma = require('../../config/database');
const { parseJsonField } = require('../../utils/helpers');
const { serializePlanForApi } = require('../../utils/listingLinks');

exports.getPricingPlans = async (req, res) => {
    try {
        const plans = await prisma.subscriptionPlan.findMany({
            where: { status: 'Active' },
            orderBy: { price: 'asc' },
        });

        const formattedPlans = plans.map((plan) => serializePlanForApi(plan, parseJsonField));

        res.json({
            success: true,
            plans: formattedPlans,
        });
    } catch (error) {
        console.error('[web/pricing]', error);
        res.status(500).json({ success: false, message: 'Failed to fetch pricing.' });
    }
};
