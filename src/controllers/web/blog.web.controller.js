const prisma = require('../../config/database');

exports.listPublished = async (req, res) => {
    try {
        const { category } = req.query;
        const where = { isPublished: true };
        if (category && category !== 'All') {
            where.category = String(category);
        }

        const posts = await prisma.blogPost.findMany({
            where,
            orderBy: { publishedAt: 'desc' },
        });

        res.json({ success: true, posts });
    } catch (error) {
        console.error('[web/blog] list', error);
        res.status(500).json({ success: false, message: 'Failed to fetch blog posts.' });
    }
};

exports.getBySlug = async (req, res) => {
    try {
        const { slug } = req.params;

        const post = await prisma.blogPost.findFirst({
            where: { slug, isPublished: true },
        });

        if (!post) {
            return res.status(404).json({ success: false, message: 'Post not found.' });
        }

        res.json({ success: true, post });
    } catch (error) {
        console.error('[web/blog] slug', error);
        res.status(500).json({ success: false, message: 'Failed to fetch post.' });
    }
};

exports.createPost = async (req, res) => {
    try {
        const { slug, title, excerpt, content, category, thumbnailUrl, authorName, isPublished } = req.body;

        const post = await prisma.blogPost.create({
            data: {
                slug,
                title,
                excerpt,
                content,
                category,
                thumbnailUrl,
                authorName: authorName || `${req.user.firstName} ${req.user.lastName}`.trim(),
                isPublished: Boolean(isPublished),
                publishedAt: new Date(),
            },
        });

        res.status(201).json({ success: true, post });
    } catch (error) {
        console.error('[web/blog] create', error);
        res.status(500).json({ success: false, message: 'Failed to create post.' });
    }
};
