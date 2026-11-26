/**
 * Meeting Management Routes - Bisonstechs ERP
 * Mounted at /api/meetings
 *
 * NOTE: static paths (/dashboard, /reports/*, /agenda/*, /action-items/*) are registered
 * BEFORE '/:id' so they are never captured as an id.
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require('../middleware/rbacMiddleware');
const ctrl = require('../controllers/meetingManagementController');

router.use(protect);

// Dashboard (must be before '/:id')
router.get('/dashboard', requirePermission('meetings.dashboard.view'), ctrl.getDashboard);

// Reports (must be before '/:id')
router.get('/reports/summary', requirePermission('meetings.reports.view'), ctrl.getReportsSummary);

// Agenda items (by item id)
router.put('/agenda/:itemId', requirePermission('meetings.agenda.edit'), ctrl.updateAgendaItem);
router.delete('/agenda/:itemId', requirePermission('meetings.agenda.delete'), ctrl.deleteAgendaItem);

// Action items (by item id)
router.put('/action-items/:itemId', requirePermission('meetings.action_items.edit'), ctrl.updateActionItem);
router.delete('/action-items/:itemId', requirePermission('meetings.action_items.delete'), ctrl.deleteActionItem);

// Meetings
router.get('/', requirePermission('meetings.meetings.view'), ctrl.getMeetings);
router.post('/', requirePermission('meetings.meetings.create'), ctrl.createMeeting);
router.get('/:id', requirePermission('meetings.meetings.view'), ctrl.getMeetingById);
router.put('/:id', requirePermission('meetings.meetings.edit'), ctrl.updateMeeting);
router.delete('/:id', requirePermission('meetings.meetings.delete'), ctrl.deleteMeeting);
router.post('/:id/complete', requirePermission('meetings.meetings.edit'), ctrl.completeMeeting);

// Participants
router.get('/:id/participants', requirePermission('meetings.participants.view'), ctrl.getParticipants);
router.post('/:id/participants', requirePermission('meetings.participants.create'), ctrl.addParticipants);
router.put('/:id/participants/:participantId', requirePermission('meetings.participants.edit'), ctrl.updateParticipant);

// Agenda
router.get('/:id/agenda', requirePermission('meetings.agenda.view'), ctrl.getAgenda);
router.post('/:id/agenda', requirePermission('meetings.agenda.create'), ctrl.createAgendaItem);

// Minutes (upsert: either create or edit permission is sufficient)
router.get('/:id/minutes', requirePermission('meetings.minutes.view'), ctrl.getMinutes);
router.put(
  '/:id/minutes',
  requireAnyPermission(['meetings.minutes.edit', 'meetings.minutes.create']),
  ctrl.upsertMinutes,
);

// Action items
router.get('/:id/action-items', requirePermission('meetings.action_items.view'), ctrl.getActionItems);
router.post('/:id/action-items', requirePermission('meetings.action_items.create'), ctrl.createActionItem);

module.exports = router;
