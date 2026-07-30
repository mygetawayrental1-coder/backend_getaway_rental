const path = require('path');
const fs = require('fs');
const prisma = require('../config/database');
const { deleteLocalFile, getFileUrl, uploadDir } = require('../config/storage');
const { parseJsonField } = require('../utils/helpers');

// file-type is ESM-only from v17+; resolve lazily on first use.
// This pattern works with both the real ESM package and Jest's CJS mock.
let _fileTypeFromFile = null;
async function getFileTypeFromFile() {
    if (_fileTypeFromFile) return _fileTypeFromFile;
    try {
        // Jest moduleNameMapper will substitute a CJS mock; in production
        // this resolves to the real ESM package via dynamic import.
        const mod = await import('file-type');
        _fileTypeFromFile = mod.fileTypeFromFile;
    } catch {
        // If resolution fails (shouldn't happen), skip magic-byte checks.
        _fileTypeFromFile = null;
    }
    return _fileTypeFromFile;
}

// sharp is optional — if not installed, re-encoding is skipped gracefully.
let sharp;
try {
    sharp = require('sharp');
} catch {
    console.warn('[upload] sharp not installed — image re-encoding disabled. Run: npm install sharp');
}

// Allowed image MIME types (magic-byte level)
const ALLOWED_MAGIC_MIMES = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
]);

/**
 * Validate the uploaded file's magic bytes against its claimed type.
 * Returns { ok: true } or { ok: false, reason: string }.
 */
async function validateMagicBytes(filePath) {
    const fileTypeFromFile = await getFileTypeFromFile();
    if (!fileTypeFromFile) {
        console.warn('[upload] file-type not available, skipping magic-byte check.');
        return { ok: true };
    }
    try {
        const result = await fileTypeFromFile(filePath);
        if (!result) {
            return { ok: false, reason: 'Could not detect file type from content.' };
        }
        if (!ALLOWED_MAGIC_MIMES.has(result.mime)) {
            return {
                ok: false,
                reason: `File content is "${result.mime}" which is not an allowed image type.`,
            };
        }
        return { ok: true };
    } catch (err) {
        console.error('[upload] magic byte check error:', err.message);
        return { ok: false, reason: 'File type verification failed.' };
    }
}

/**
 * Re-encode the image using sharp (strips metadata, ensures safe output).
 * Overwrites the file in-place. If sharp is unavailable, no-ops gracefully.
 */
async function reEncodeImage(filePath) {
    if (!sharp) return;
    try {
        const ext = path.extname(filePath).toLowerCase();
        const tmpPath = `${filePath}.tmp`;

        let pipeline = sharp(filePath).rotate(); // auto-rotate from EXIF, strips EXIF

        if (ext === '.png') {
            pipeline = pipeline.png({ compressionLevel: 7 });
        } else if (ext === '.gif') {
            pipeline = pipeline.gif();
        } else if (ext === '.webp') {
            pipeline = pipeline.webp({ quality: 85 });
        } else {
            // jpeg / jfif / jpe
            pipeline = pipeline.jpeg({ quality: 85, progressive: true });
        }

        await pipeline.toFile(tmpPath);
        fs.renameSync(tmpPath, filePath); // atomic replace
    } catch (err) {
        console.error('[upload] sharp re-encode error:', err.message);
        // Non-fatal: original file is still valid; don't block the upload.
    }
}

// Upload single file
const uploadFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded.',
            });
        }

        // 1. Magic-byte validation
        const magicCheck = await validateMagicBytes(req.file.path);
        if (!magicCheck.ok) {
            // Remove the unsafe file before responding
            try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
            return res.status(400).json({
                success: false,
                message: magicCheck.reason,
            });
        }

        // 2. Strip EXIF metadata & re-encode via sharp
        await reEncodeImage(req.file.path);

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

        const results = [];
        const rejected = [];

        for (const file of req.files) {
            // 1. Magic-byte validation per file
            const magicCheck = await validateMagicBytes(file.path);
            if (!magicCheck.ok) {
                try { fs.unlinkSync(file.path); } catch { /* ignore */ }
                rejected.push({ filename: file.originalname, reason: magicCheck.reason });
                continue;
            }

            // 2. Re-encode via sharp
            await reEncodeImage(file.path);

            const relativePath = path.relative(uploadDir, file.path).replace(/\\/g, '/');
            results.push({
                url: getFileUrl(req, relativePath),
                key: relativePath,
                size: file.size,
                mimetype: file.mimetype,
                filename: file.filename,
            });
        }

        if (results.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'All uploaded files were rejected.',
                rejected,
            });
        }

        res.json({
            success: true,
            message: 'Files uploaded successfully.',
            data: results,
            ...(rejected.length > 0 && { rejected }),
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
