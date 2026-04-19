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
        const ext = path.extname(file.originalname);
        const filename = `${uuidv4()}${ext}`;
        cb(null, filename);
    },
});

// Configure multer
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed!'));
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

// Get public URL for a file
const getFileUrl = (req, relativePath) => {
    const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 5000}`;
    return `${baseUrl}/uploads/${relativePath}`;
};

module.exports = {
    upload,
    deleteLocalFile,
    getFileUrl,
    uploadDir,
    sanitizeUploadSubfolder,
};
