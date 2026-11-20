'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getDocumentNumberingSettings,
  putDocumentNumberingSettings,
} = require('../controllers/documentNumberingController');

router.use(protect);

router.get('/', getDocumentNumberingSettings);
router.put('/', putDocumentNumberingSettings);

module.exports = router;
