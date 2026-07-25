const path = require('path');
const prisma = require('../config/database');
const { deleteLocalFile, getFileUrl, uploadDir } = require('../config/storage');
const { parseJsonField } = require('../utils/helpers');

// Upload single file
const uploadFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded.',
            });
        }

        // Build the relative path from upload dir
        const relativePath = path.relative(uploadDir, req.file.path).replace(/\\/g, '/');

        res.json({
            success: true,
            message: 'File uploaded successfully.',
            data: {
                url: getFileUrl(req, relativePath),
                key: relativePath,
                size: req.file.size,
                mimetype: req.file.mimetype,
                filename: req.file.filename,
            },
        });
    } catch (error) {
        console.error('Upload file error:', error);
        res.status(500).json({
            success: false,
            message: 'File upload failed.',
        });
    }
};

// Upload multiple files
const uploadMultipleFiles = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No files uploaded.',
            });
        }

        const files = req.files.map(file => {
            const relativePath = path.relative(uploadDir, file.path).replace(/\\/g, '/');
            return {
                url: getFileUrl(req, relativePath),
                key: relativePath,
                size: file.size,
                mimetype: file.mimetype,
                filename: file.filename,
            };
        });

        res.json({
            success: true,
            message: 'Files uploaded successfully.',
            data: files,
        });
    } catch (error) {
        console.error('Upload multiple files error:', error);
        res.status(500).json({
            success: false,
            message: 'Files upload failed.',
        });
    }
};

function pathMatchesKey(stored, decodedKey) {
    if (!stored || !decodedKey) return false;
    const s = String(stored);
    const k = decodedKey.replace(/^\/+/, '');
    return (
        s.includes(decodedKey) ||
        s.includes(k) ||
        s.endsWith(path.basename(decodedKey)) ||
        s.includes(`/uploads/${k}`) ||
        s.includes(`uploads/${k}`)
    );
}

async function userOwnsUpload(user, decodedKey) {
    if (!user) return false;
    if (user.role === 'ADMIN') return true;

    if (pathMatchesKey(user.profilePic, decodedKey)) return true;

    const properties = await prisma.property.findMany({
        where: { ownerId: user.id },
        select: { images: true, videoUrl: true },
    });

    for (const p of properties) {
        if (pathMatchesKey(p.videoUrl, decodedKey)) return true;
        const imgs = parseJsonField(p.images);
        if (Array.isArray(imgs) && imgs.some((img) => pathMatchesKey(img, decodedKey))) {
            return true;
        }
    }
    return false;
}

// Delete file
const deleteFile = async (req, res) => {
    try {
        const { key } = req.params;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: 'File key is required.',
            });
        }

        const decodedKey = decodeURIComponent(key);

        const allowed = await userOwnsUpload(req.user, decodedKey);
        if (!allowed) {
            return res.status(403).json({
                success: false,
                message: 'You can only delete your own uploads.',
            });
        }

        await deleteLocalFile(decodedKey);

        res.json({
            success: true,
            message: 'File deleted successfully.',
        });
    } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete file.',
        });
    }
};

module.exports = {
    uploadFile,
    uploadMultipleFiles,
    deleteFile,
};
