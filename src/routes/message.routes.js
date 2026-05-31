const express = require('express');
const router = express.Router();
const messageController = require('../controllers/message.controller');
const { authenticate, optionalAuth } = require('../middleware/auth');

router.post('/conversations', optionalAuth, messageController.getOrCreateConversation);
router.get('/conversations', authenticate, messageController.getConversations);
router.get('/unread-count', authenticate, messageController.getUnreadMessageCount);
router.get('/conversations/:conversationId', authenticate, messageController.getMessages);
router.post('/conversations/:conversationId', optionalAuth, messageController.sendMessage);

module.exports = router;
