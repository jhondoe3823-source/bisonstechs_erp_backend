'use strict';

const router = require('express').Router();
const { protectOnly } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/companyController');

// Public tenant subdomain helpers (no auth)
router.get('/check-slug', ctrl.checkSlug);
router.get('/resolve-slug/:slug', ctrl.resolveSlug);

router.get('/mine', protectOnly, ctrl.listMyCompanies);
router.post('/', protectOnly, ctrl.createCompany);
router.put('/active', protectOnly, ctrl.setPrimaryCompany);
router.get('/consolidated-dashboard', protectOnly, ctrl.consolidatedDashboard);
router.get('/business-config', protectOnly, ctrl.getBusinessConfig);
router.patch('/business-config', protectOnly, ctrl.updateBusinessConfig);
router.patch('/:id/manufacturing-workflow', protectOnly, ctrl.updateManufacturingWorkflow);

module.exports = router;
