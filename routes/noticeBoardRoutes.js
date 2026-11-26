/**
 * Notice Board Routes - Bisonstechs ERP
 * Mounted at /api/notices
 *
 * NOTE: static paths (/dashboard, /categories, /settings, /reports/*, /comments/*) are
 * registered BEFORE '/:id' so they are never captured as an id.
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');
const ctrl = require('../controllers/noticeBoardController');

router.use(protect);

// Dashboard & categories (must be before '/:id')
router.get('/dashboard', requirePermission('notices.dashboard.view'), ctrl.getDashboard);
router.get('/categories', requirePermission('notices.categories.view'), ctrl.getCategories);
router.post('/categories', requirePermission('notices.categories.create'), ctrl.createCategory);

// Settings (must be before '/:id')
router.get('/settings', requirePermission('notices.settings.view'), ctrl.getNoticeSettings);
router.put('/settings', requirePermission('notices.settings.edit'), ctrl.updateNoticeSettings);

// Reports (must be before '/:id')
router.get('/reports/summary', requirePermission('notices.reports.view'), ctrl.getReportsSummary);

// Comments (by comment id)
router.delete('/comments/:commentId', requirePermission('notices.comments.delete'), ctrl.deleteComment);

// Notices
router.get('/', requirePermission('notices.notices.view'), ctrl.getNotices);
router.post('/', requirePermission('notices.notices.create'), ctrl.createNotice);
router.get('/:id', requirePermission('notices.notices.view'), ctrl.getNoticeById);
router.put('/:id', requirePermission('notices.notices.edit'), ctrl.updateNotice);
router.delete('/:id', requirePermission('notices.notices.delete'), ctrl.deleteNotice);
router.post('/:id/approve', requirePermission('notices.notices.approve'), ctrl.approveNotice);
router.post('/:id/read', requirePermission('notices.notices.view'), ctrl.markRead);

// Comments on a notice
router.get('/:id/comments', requirePermission('notices.comments.view'), ctrl.getComments);
router.post('/:id/comments', requirePermission('notices.comments.create'), ctrl.createComment);

// Read receipts
router.get('/:id/reads', requirePermission('notices.reports.view'), ctrl.getReads);

// Audience
router.put('/:id/audience', requirePermission('notices.audience.edit'), ctrl.updateAudience);

module.exports = router;
