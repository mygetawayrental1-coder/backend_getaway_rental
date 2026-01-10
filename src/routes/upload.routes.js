const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/upload.controller');
const { authenticate } = require('../middleware/auth');
const { uploadSingle, uploadMultiple, handleUploadError } = require('../middleware/upload');

// Upload routes
router.post('/public', authenticate, uploadSingle, handleUploadError, uploadController.uploadFile);
router.post('/multiple', authenticate, uploadMultiple, handleUploadError, uploadController.uploadMultipleFiles);
router.delete('/:key', authenticate, uploadController.deleteFile);

module.exports = router;
