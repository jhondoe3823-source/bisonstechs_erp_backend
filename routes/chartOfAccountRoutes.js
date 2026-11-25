const express = require('express');
const {
  createAccount,
  getAccounts,
  getAccount,
  updateAccount,
  deleteAccount,
  archiveAccount,
  getAccountSummary,
  searchAccounts,
  getAccountsByType,
  fixCashAccounts,
  getAccountTypeStats,
  bulkImportAccounts,
  getOpeningBalanceStatus,
  getOpeningBalanceSummary,
  validateOpeningBalance,
} = require('../controllers/chartOfAccountController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(protect);

// Static paths MUST be registered before /:id
router.get('/summary', getAccountSummary);
router.get('/search', searchAccounts);
router.get('/type-stats', getAccountTypeStats);
router.get('/by-type/:type', getAccountsByType);
router.get('/opening-balance-status', getOpeningBalanceStatus);
router.get('/check-opening-balance', getOpeningBalanceStatus);
router.get('/opening-balance-summary', getOpeningBalanceSummary);
router.post('/validate-opening-balance', validateOpeningBalance);
router.post('/fix-cash-accounts', fixCashAccounts);
router.post('/bulk-import', bulkImportAccounts);

router.route('/')
  .get(getAccounts)
  .post(createAccount);

router.patch('/:id/archive', archiveAccount);

router.route('/:id')
  .get(getAccount)
  .put(updateAccount)
  .delete(deleteAccount);

module.exports = router;
