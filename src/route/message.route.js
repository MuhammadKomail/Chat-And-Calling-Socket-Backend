const express = require('express');
const router = express.Router();
const messageController = require('../controllers/message.controller');

// GET /api/messages/:roomId
router.get('/messages/:roomId', messageController.getRoomMessages);

module.exports = router;
