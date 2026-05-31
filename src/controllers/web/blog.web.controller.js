const prisma = require('../../config/database');
const { parseJsonField } = require('../../utils/helpers');

function formatBlogPost(post) {
    return {
        ...post,
        readTimeMin: post.readTimeMin ?? null,
        tags: parseJsonField(post.tags) || [],
    };
}

exports.listPublished = async (req, res) => {
    try {
        const { category, tag } = req.query;
        const where = { isPublished: true };

        if (category && category !== 'All') {
            where.category = String(category);
        }

        if (tag) {
            const tagTerm = String(tag).trim();
            if (tagTerm) {
                where.tags = { contains: tagTerm, mode: 'insensitive' };
            }
        }

        const posts = await prisma.blogPost.findMany({
            where,
            orderBy: { publishedAt: 'desc' },
        });

        res.json({ success: true, posts: posts.map(formatBlogPost) });
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

        res.json({ success: true, post: formatBlogPost(post) });
    } catch (error) {
        console.error('[web/blog] slug', error);
        res.status(500).json({ success: false, message: 'Failed to fetch post.' });
    }
};

exports.createPost = async (req, res) => {
    try {
        const { slug, title, excerpt, content, category, thumbnailUrl, authorName, isPublished, tags, readTimeMin } = req.body;

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
                tags: tags ? JSON.stringify(tags) : null,
                readTimeMin: readTimeMin != null ? parseInt(readTimeMin, 10) : null,
            },
        });

        res.status(201).json({ success: true, post: formatBlogPost(post) });
    } catch (error) {
        console.error('[web/blog] create', error);
        res.status(500).json({ success: false, message: 'Failed to create post.' });
    }
};

exports.listAllAdmin = async (req, res) => {
    try {
        const posts = await prisma.blogPost.findMany({
            orderBy: { createdAt: 'desc' },
        });

        res.json({ success: true, posts: posts.map(formatBlogPost) });
    } catch (error) {
        console.error('[web/blog] admin list', error);
        res.status(500).json({ success: false, message: 'Failed to fetch blog posts.' });
    }
};

exports.updatePost = async (req, res) => {
    try {
        const { id } = req.params;
        const body = req.body || {};

        const existing = await prisma.blogPost.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Post not found.' });
        }

        const data = {};
        if (body.title !== undefined) data.title = body.title;
        if (body.excerpt !== undefined) data.excerpt = body.excerpt;
        if (body.content !== undefined) data.content = body.content;
        if (body.category !== undefined) data.category = body.category;
        if (body.thumbnailUrl !== undefined) data.thumbnailUrl = body.thumbnailUrl;
        if (body.authorName !== undefined) data.authorName = body.authorName;
        if (body.readTimeMin !== undefined) {
            data.readTimeMin = body.readTimeMin != null ? parseInt(body.readTimeMin, 10) : null;
        }
        if (body.tags !== undefined) {
            data.tags = body.tags ? JSON.stringify(body.tags) : null;
        }
        if (body.isPublished !== undefined) {
            data.isPublished = Boolean(body.isPublished);
            if (data.isPublished && !existing.isPublished) {
                data.publishedAt = new Date();
            }
        }

        const post = await prisma.blogPost.update({
            where: { id },
            data,
        });

        res.json({ success: true, post: formatBlogPost(post) });
    } catch (error) {
        console.error('[web/blog] update', error);
        res.status(500).json({ success: false, message: 'Failed to update post.' });
    }
};
