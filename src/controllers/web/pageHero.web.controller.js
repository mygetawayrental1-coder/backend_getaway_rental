const prisma = require('../../config/database');

const ALLOWED_SIZES = new Set(['sm', 'md', 'lg']);

/** Seed defaults — match current website hardcoded heroes */
const DEFAULT_HEROES = [
    {
        pageKey: 'home',
        label: 'Home',
        path: '/',
        title: 'Find your Perfect Rental',
        description:
            'Entire homes, private villas, and unique stays—book direct with trusted owners.',
        imageUrl:
            'https://images.unsplash.com/photo-1506929562872-bb421503ef21?w=1920&q=85',
        imageAlt: 'Coastal vacation destination with boats along the shore at sunset',
        breadcrumbLabel: null,
        eyebrow: 'Vacation rentals for every trip',
        size: 'lg',
        metaTitle: 'Vacation Rentals Across the US',
        metaDescription:
            'Find vacation rentals, villas, and unique stays. Book direct with trusted owners on MyGetawayRental.',
        sortOrder: 0,
    },
    {
        pageKey: 'about',
        label: 'About',
        path: '/about',
        title: 'Stays that feel like home—wherever you go',
        description:
            'MyGetawayRental helps travelers discover vacation rentals and gives owners a simple way to share their properties with guests who are ready to book.',
        imageUrl:
            'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&q=85&auto=format&fit=crop',
        imageAlt: 'Tropical beach shoreline representing getaway travel destinations',
        breadcrumbLabel: 'About us',
        eyebrow: 'Our story',
        size: 'lg',
        metaTitle: 'About us',
        metaDescription:
            'Learn how MyGetawayRental connects travelers with memorable vacation stays and helps property owners list with confidence.',
        sortOrder: 1,
    },
    {
        pageKey: 'contact',
        label: 'Contact',
        path: '/contact',
        title: 'Contact us',
        description:
            "Questions about a booking, listing your property, or partnerships? Reach out by phone, email, or the form below—we're here to help.",
        imageUrl:
            'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=1920&q=85&auto=format&fit=crop',
        imageAlt: 'Team collaborating in a bright office, ready to help guests and owners',
        breadcrumbLabel: 'Contact',
        eyebrow: null,
        size: 'md',
        metaTitle: 'Contact us',
        metaDescription: 'Get in touch with the MyGetawayRental team.',
        sortOrder: 2,
    },
    {
        pageKey: 'blog',
        label: 'Blog',
        path: '/blog',
        title: 'Vacation rental blog & travel guides',
        description:
            'Destination ideas, booking tips, and stay inspiration to help you plan your next getaway.',
        imageUrl:
            'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1920&q=85&auto=format&fit=crop',
        imageAlt: 'Modern vacation rental living room with a red armchair and desk by the window',
        breadcrumbLabel: 'Blog',
        eyebrow: null,
        size: 'md',
        metaTitle: 'Vacation Rental Blog & Travel Guides',
        metaDescription:
            'Travel tips, destination guides, and vacation rental advice from MyGetawayRental — plan better trips and book with confidence.',
        sortOrder: 3,
    },
    {
        pageKey: 'pricing',
        label: 'Pricing',
        path: '/pricing',
        title: 'Simple plans to list your property',
        description:
            'Choose a subscription that fits your portfolio. Manage listings, bookings, and payouts from one owner dashboard.',
        imageUrl:
            'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1920&q=85&auto=format&fit=crop',
        imageAlt: 'Bright furnished vacation rental living space for property owners',
        breadcrumbLabel: 'Pricing',
        eyebrow: null,
        size: 'md',
        metaTitle: 'Owner plans',
        metaDescription:
            'Choose a subscription plan to list and manage your vacation rentals on MyGetawayRental.',
        sortOrder: 4,
    },
    {
        pageKey: 'partner',
        label: 'Owner profile',
        path: '/partner-page',
        title: 'Owner profile',
        description:
            "Explore this host's vacation rental listings, learn more about their properties, and find a stay that fits your trip.",
        imageUrl:
            'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1920&q=85&auto=format&fit=crop',
        imageAlt: 'Exterior of a luxury vacation home listed by a MyGetawayRental host',
        breadcrumbLabel: 'Owner profile',
        eyebrow: null,
        size: 'md',
        metaTitle: 'Owner profile',
        metaDescription:
            'View vacation rental listings and details from this MyGetawayRental property owner.',
        sortOrder: 5,
    },
    {
        pageKey: 'listings',
        label: 'Full map layout',
        path: '/full-map-layout',
        title: 'Full map layout',
        description:
            'Browse vacation rentals on an interactive map. Filter by location, dates, and amenities to find your next stay.',
        imageUrl:
            'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=85&auto=format&fit=crop',
        imageAlt: 'Mountain landscape representing vacation rental destinations on the map',
        breadcrumbLabel: 'Full map layout',
        eyebrow: null,
        size: 'sm',
        metaTitle: 'Full Map Layout',
        metaDescription:
            'Browse vacation rentals on an interactive map across the United States.',
        sortOrder: 6,
    },
    {
        pageKey: 'search',
        label: 'Search rentals',
        path: '/search-rental-full-map',
        title: 'Search vacation rentals',
        description:
            'Browse stays across the United States on the map or in the grid. Filter by location, dates, guests, and amenities.',
        imageUrl:
            'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=1920&q=85&auto=format&fit=crop',
        imageAlt: 'Overwater bungalows representing searchable vacation rental stays',
        breadcrumbLabel: 'Search rentals',
        eyebrow: null,
        size: 'md',
        metaTitle: 'Search rentals',
        metaDescription:
            'Browse vacation rentals across the United States on the map or in the grid.',
        sortOrder: 7,
    },
];

let seedPromise = null;

async function ensureDefaults() {
    if (!seedPromise) {
        seedPromise = (async () => {
            for (const row of DEFAULT_HEROES) {
                const existing = await prisma.pageHeroConfig.findUnique({
                    where: { pageKey: row.pageKey },
                });
                if (!existing) {
                    await prisma.pageHeroConfig.create({
                        data: { ...row, useCmsValues: true },
                    });
                } else if (!existing.imageAlt && row.imageAlt) {
                    await prisma.pageHeroConfig.update({
                        where: { pageKey: row.pageKey },
                        data: { imageAlt: row.imageAlt },
                    });
                }
            }
        })().catch((err) => {
            seedPromise = null;
            throw err;
        });
    }
    return seedPromise;
}

exports.listPublic = async (req, res) => {
    try {
        await ensureDefaults();
        const heroes = await prisma.pageHeroConfig.findMany({
            orderBy: { sortOrder: 'asc' },
        });
        res.json({ success: true, heroes });
    } catch (error) {
        console.error('[web/page-heroes] list', error);
        res.status(500).json({ success: false, message: 'Failed to fetch page heroes.' });
    }
};

exports.getByKey = async (req, res) => {
    try {
        await ensureDefaults();
        const pageKey = String(req.params.pageKey || '').trim();
        const hero = await prisma.pageHeroConfig.findUnique({ where: { pageKey } });
        if (!hero) {
            return res.status(404).json({ success: false, message: 'Page hero not found.' });
        }
        res.json({ success: true, hero });
    } catch (error) {
        console.error('[web/page-heroes] get', error);
        res.status(500).json({ success: false, message: 'Failed to fetch page hero.' });
    }
};

exports.listAdmin = async (req, res) => {
    try {
        await ensureDefaults();
        const heroes = await prisma.pageHeroConfig.findMany({
            orderBy: { sortOrder: 'asc' },
        });
        res.json({ success: true, heroes });
    } catch (error) {
        console.error('[web/page-heroes] admin list', error);
        res.status(500).json({ success: false, message: 'Failed to fetch page heroes.' });
    }
};

exports.updateAdmin = async (req, res) => {
    try {
        await ensureDefaults();
        const pageKey = String(req.params.pageKey || '').trim();
        const existing = await prisma.pageHeroConfig.findUnique({ where: { pageKey } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Page hero not found.' });
        }

        const {
            title,
            description,
            imageUrl,
            imageAlt,
            breadcrumbLabel,
            eyebrow,
            size,
            metaTitle,
            metaDescription,
            useCmsValues,
        } = req.body;

        const data = {};

        if (title !== undefined) {
            const t = String(title).trim();
            if (!t) {
                return res.status(400).json({ success: false, message: 'H1 title is required.' });
            }
            data.title = t;
        }

        if (description !== undefined) {
            const d = String(description).trim();
            if (!d) {
                return res.status(400).json({ success: false, message: 'Description is required.' });
            }
            data.description = d;
        }

        if (imageUrl !== undefined) {
            const img = String(imageUrl).trim();
            if (!img) {
                return res.status(400).json({ success: false, message: 'Hero image URL is required.' });
            }
            data.imageUrl = img;
        }

        if (imageAlt !== undefined) {
            data.imageAlt =
                imageAlt === null || imageAlt === '' ? null : String(imageAlt).trim().slice(0, 200);
        }

        if (breadcrumbLabel !== undefined) {
            data.breadcrumbLabel =
                breadcrumbLabel === null || breadcrumbLabel === ''
                    ? null
                    : String(breadcrumbLabel).trim();
        }

        if (eyebrow !== undefined) {
            data.eyebrow =
                eyebrow === null || eyebrow === '' ? null : String(eyebrow).trim();
        }

        if (size !== undefined) {
            const s = String(size).trim();
            if (!ALLOWED_SIZES.has(s)) {
                return res.status(400).json({ success: false, message: 'Size must be sm, md, or lg.' });
            }
            data.size = s;
        }

        if (metaTitle !== undefined) {
            data.metaTitle =
                metaTitle === null || metaTitle === '' ? null : String(metaTitle).trim();
        }

        if (metaDescription !== undefined) {
            data.metaDescription =
                metaDescription === null || metaDescription === ''
                    ? null
                    : String(metaDescription).trim();
        }

        if (useCmsValues !== undefined) {
            data.useCmsValues = Boolean(useCmsValues);
        }

        if (Object.keys(data).length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update.' });
        }

        const hero = await prisma.pageHeroConfig.update({
            where: { pageKey },
            data,
        });

        res.json({ success: true, hero, message: 'Page hero updated.' });
    } catch (error) {
        console.error('[web/page-heroes] update', error);
        res.status(500).json({ success: false, message: 'Failed to update page hero.' });
    }
};

exports.DEFAULT_HEROES = DEFAULT_HEROES;
