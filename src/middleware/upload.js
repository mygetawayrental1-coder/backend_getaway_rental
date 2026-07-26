const { upload } = require('../config/storage');

// Single file upload middleware
const uploadSingle = upload.single('file');

// Multiple files upload middleware (max 50 per field)
// Accept both `files` and `images` keys for compatibility across clients.
const uploadMultipleBase = upload.fields([
    { name: 'files', maxCount: 50 },
    { name: 'images', maxCount: 50 },
]);

const uploadMultiple = (req, res, next) => {
    uploadMultipleBase(req, res, (err) => {
        if (!err && req.files && !Array.isArray(req.files)) {
            req.files = [
                ...(req.files.files || []),
                ...(req.files.images || []),
            ];
        }
        next(err);
    });
};

// Handle upload errors
const handleUploadError = (err, req, res, next) => {
    if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File size exceeds 10MB limit.',
            });
        }
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                message: 'Too many files in one upload (max 50 per request).',
            });
        }
        if (
            err.message === 'Only image files are allowed!' ||
            String(err.message || '').startsWith('Only image files are allowed')
        ) {
            return res.status(400).json({
                success: false,
                message: err.message,
            });
        }
        return res.status(500).json({
            success: false,
            message: 'File upload failed.',
            error: err.message,
        });
    }
    next();
};

module.exports = {
    uploadSingle,
    uploadMultiple,
    handleUploadError,
};
