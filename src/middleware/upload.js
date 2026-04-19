const { upload } = require('../config/storage');

// Single file upload middleware
const uploadSingle = upload.single('file');

// Multiple files upload middleware (max 10)
// Accept both `files` and `images` keys for compatibility across clients.
const uploadMultipleBase = upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'images', maxCount: 10 },
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
        if (err.message === 'Only image files are allowed!') {
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
