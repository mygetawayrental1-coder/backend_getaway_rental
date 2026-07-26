const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Ensure upload directory exists
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

/** Build a safe subpath under uploadDir from query.folder (blocks .. traversal). */
function sanitizeUploadSubfolder(folder) {
    if (!folder || typeof folder !== 'string') {
        return 'general';
    }
    const parts = folder.split(/[/\\]+/).filter(Boolean).map((p) => path.basename(p));
    const safe = parts.filter((p) => /^[a-zA-Z0-9_-]{1,64}$/.test(p));
    return safe.length === 0 ? 'general' : path.join(...safe);
}

// Configure local disk storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const sub = sanitizeUploadSubfolder(req.query.folder);
        const destPath = path.resolve(uploadDir, sub);
        const root = path.resolve(uploadDir);
        if (!destPath.startsWith(root + path.sep) && destPath !== root) {
            return cb(new Error('Invalid upload folder.'));
        }

        // Create subfolder if it doesn't exist
        if (!fs.existsSync(destPath)) {
            fs.mkdirSync(destPath, { recursive: true });
        }
        cb(null, destPath);
    },
    filename: function (req, file, cb) {
        // JFIF is JPEG — store as .jpg so browsers/CDN serve it reliably.
        let ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.jfif' || ext === '.jpe') ext = '.jpg';
        if (!ext) ext = '.jpg';
        const filename = `${uuidv4()}${ext}`;
        cb(null, filename);
    },
});

const ALLOWED_IMAGE_EXTS = new Set([
    '.jpeg',
    '.jpg',
    '.jfif',
    '.jpe',
    '.png',
    '.gif',
    '.webp',
]);
const ALLOWED_IMAGE_MIMES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/jfif',
    'image/pjpeg',
    'image/png',
    'image/gif',
    'image/webp',
]);

// Configure multer
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: function (req, file, cb) {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const mime = String(file.mimetype || '').toLowerCase();
        const extOk = ALLOWED_IMAGE_EXTS.has(ext);
        // Some browsers send JFIF as image/jpeg; others as image/jfif.
        const mimeOk =
            ALLOWED_IMAGE_MIMES.has(mime) ||
            (ext === '.jfif' && (mime === 'image/jpeg' || mime === 'application/octet-stream'));

        if (extOk && mimeOk) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed (jpg, jpeg, jfif, png, gif, webp)!'));
    },
});

// Delete file from local storage (relative key only; must stay under uploadDir)
const deleteLocalFile = async (filePath) => {
    try {
        const relative = String(filePath || '').replace(/\\/g, '/').trim();
        if (!relative || relative.includes('..')) {
            throw new Error('Invalid file path');
        }
        const segments = relative.split('/').filter(Boolean).map((s) => path.basename(s))
            .filter((s) => s && s !== '.' && s !== '..');
        if (segments.length === 0) {
            throw new Error('Invalid file path');
        }
        const fullPath = path.resolve(uploadDir, ...segments);
        const root = path.resolve(uploadDir);
        if (!fullPath.startsWith(root + path.sep) && fullPath !== root) {
            throw new Error('Invalid file path');
        }
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Local Delete Error:', error);
        throw error;
    }
};

// Get public URL for a file (relativePath is under uploadDir, e.g. general/uuid.jpg)
const getFileUrl = (req, relativePath) => {
    const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 5000}`;
    const key = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    return `${baseUrl.replace(/\/$/, '')}/uploads/${key}`;
};

/** Public path stored in DB — includes subfolder (e.g. /uploads/general/uuid.png). */
function multerFileToPublicPath(file) {
    if (!file?.path) {
        return `/uploads/${file.filename}`;
    }
    const root = path.resolve(uploadDir);
    const rel = path.relative(root, path.resolve(file.path)).replace(/\\/g, '/');
    return `/uploads/${rel}`;
}

module.exports = {
    upload,
    deleteLocalFile,
    getFileUrl,
    multerFileToPublicPath,
    uploadDir,
    sanitizeUploadSubfolder,
};
