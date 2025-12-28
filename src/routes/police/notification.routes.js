const express = require('express');
const router = express.Router();
const { getMyNotifications, markAsRead } = require('../../controllers/police/notification.controller'); 
const { protect, authorize } = require('../../middleware/auth.middleware'); 

router.get('/', protect, getMyNotifications);
router.patch('/:id/read', protect, markAsRead);

module.exports = router;