const router = require('express').Router();
const controller = require('../controllers/notification.controller');

// Register or update device token
router.post('/register-token', controller.registerToken);

// Send a test notification to a user's device
router.post('/send-test', controller.sendTest);

module.exports = router;
