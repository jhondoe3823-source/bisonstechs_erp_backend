'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getSalesAgentSettings,
  putSalesAgentSettings,
  previewCommissionSlab,
} = require('../controllers/salesAgentSettingsController');

router.use(protect);

router.get('/', getSalesAgentSettings);
router.put('/', putSalesAgentSettings);
router.post('/preview-slab', previewCommissionSlab);

module.exports = router;
