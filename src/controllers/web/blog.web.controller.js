const prisma = require('../../config/database');
const { parseJsonField } = require('../../utils/helpers');

function slugify(text) {
    return String(text)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

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
        const {
            slug: rawSlug,
            title,
            excerpt,
            content,
            category,
            thumbnailUrl,
            authorName,
            isPublished,
            tags,
            readTimeMin,
        } = req.body;

        if (!title?.trim() || !excerpt?.trim() || !content?.trim() || !category?.trim() || !thumbnailUrl?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Title, short summary, article, category, and cover photo are required.',
            });
        }

        const slug = rawSlug?.trim() || slugify(title);
        if (!slug) {
            return res.status(400).json({ success: false, message: 'A valid slug is required.' });
        }

        const existingSlug = await prisma.blogPost.findUnique({ where: { slug } });
        if (existingSlug) {
            return res.status(409).json({ success: false, message: 'A post with this slug already exists.' });
        }

        const published = Boolean(isPublished);

        const post = await prisma.blogPost.create({
            data: {
                slug,
                title: title.trim(),
                excerpt: excerpt.trim(),
                content,
                category: category.trim(),
                thumbnailUrl: thumbnailUrl.trim(),
                authorName: authorName?.trim() || `${req.user.firstName} ${req.user.lastName}`.trim(),
                isPublished: published,
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

exports.getByIdAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const post = await prisma.blogPost.findUnique({ where: { id } });

        if (!post) {
            return res.status(404).json({ success: false, message: 'Post not found.' });
        }

        res.json({ success: true, post: formatBlogPost(post) });
    } catch (error) {
        console.error('[web/blog] admin get', error);
        res.status(500).json({ success: false, message: 'Failed to fetch post.' });
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
        if (body.slug !== undefined) {
            const nextSlug = String(body.slug).trim();
            if (nextSlug && nextSlug !== existing.slug) {
                const slugTaken = await prisma.blogPost.findUnique({ where: { slug: nextSlug } });
                if (slugTaken) {
                    return res.status(409).json({ success: false, message: 'A post with this slug already exists.' });
                }
                data.slug = nextSlug;
            }
        }
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

exports.deletePost = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await prisma.blogPost.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Post not found.' });
        }

        await prisma.blogPost.delete({ where: { id } });

        res.json({ success: true, message: 'Post deleted.' });
    } catch (error) {
        console.error('[web/blog] delete', error);
        res.status(500).json({ success: false, message: 'Failed to delete post.' });
    }
};
