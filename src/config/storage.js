const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Ensure upload directory exists
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure local disk storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const folder = req.query.folder || 'general';
        const destPath = path.join(uploadDir, folder);

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

// Delete file from local storage
const deleteLocalFile = async (filePath) => {
    try {
        const fullPath = path.join(uploadDir, filePath);
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
};
