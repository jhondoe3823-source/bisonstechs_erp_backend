// routes/inventoryRoutes.js — valuation + import + settings + UOM

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const {
  getInventoryValuation,
  getValuationSummary,
  getCategoryBreakdown,
} = require('../controller/inventory_controller');
const {
  upload,
  downloadTemplate,
  previewImport,
  confirmImport,
  getImportBatches,
  getImportBatch,
  getSettings,
  putSettings,
  getUoms,
  postUom,
  putUom,
  deleteUom,
} = require('../controller/inventoryImportController');

router.use(protect);

router.get('/valuation', getInventoryValuation);
router.get('/valuation/summary', getValuationSummary);
router.get('/valuation/categories', getCategoryBreakdown);

router.get('/settings', getSettings);
router.put('/settings', putSettings);
router.get('/uoms', getUoms);
router.post('/uoms', postUom);
router.put('/uoms/:id', putUom);
router.delete('/uoms/:id', deleteUom);

router.get('/import/template', downloadTemplate);
router.get('/import/batches', getImportBatches);
router.get('/import/batches/:batchId', getImportBatch);
router.post(
  '/import/preview',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
      return next();
    });
  },
  previewImport
);
router.post('/import/:batchId/confirm', confirmImport);

module.exports = router;
