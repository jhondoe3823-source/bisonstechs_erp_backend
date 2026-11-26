/**
 * Project Management Routes - Bisonstechs ERP
 * Mounted at /api/projects
 *
 * NOTE: static paths (/dashboard, /settings, /reports/*, /milestones/*, /time-entries/*,
 * /checklist/*, /tasks/*) are registered BEFORE '/:id' so they are never captured as an id.
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');
const ctrl = require('../controllers/projectManagementController');

router.use(protect);

// Dashboard (must be before '/:id')
router.get('/dashboard', requirePermission('projects.dashboard.view'), ctrl.getDashboard);

// Settings (must be before '/:id')
router.get('/settings', requirePermission('projects.settings.view'), ctrl.getProjectSettings);
router.put('/settings', requirePermission('projects.settings.edit'), ctrl.updateProjectSettings);

// Reports (must be before '/:id')
router.get('/reports/summary', requirePermission('projects.reports.view'), ctrl.getReportsSummary);

// Milestones (by milestone id)
router.put('/milestones/:milestoneId', requirePermission('projects.milestones.edit'), ctrl.updateMilestone);
router.delete('/milestones/:milestoneId', requirePermission('projects.milestones.delete'), ctrl.deleteMilestone);

// Time entries (by entry id)
router.post('/time-entries/:entryId/stop', requirePermission('projects.time.edit'), ctrl.stopTimeEntry);
router.put('/time-entries/:entryId', requirePermission('projects.time.edit'), ctrl.updateTimeEntry);
router.delete('/time-entries/:entryId', requirePermission('projects.time.delete'), ctrl.deleteTimeEntry);

// Checklist items (by item id)
router.put('/checklist/:itemId', requirePermission('projects.tasks.edit'), ctrl.updateChecklistItem);

// Tasks (task-level update by task id)
router.put('/tasks/:taskId', requirePermission('projects.tasks.edit'), ctrl.updateTask);

// Projects
router.get('/', requirePermission('projects.projects.view'), ctrl.getProjects);
router.post('/', requirePermission('projects.projects.create'), ctrl.createProject);
router.get('/:id', requirePermission('projects.projects.view'), ctrl.getProjectById);
router.put('/:id', requirePermission('projects.projects.edit'), ctrl.updateProject);
router.delete('/:id', requirePermission('projects.projects.delete'), ctrl.deleteProject);

// Project tasks
router.get('/:id/tasks', requirePermission('projects.tasks.view'), ctrl.getProjectTasks);
router.post('/:id/tasks', requirePermission('projects.tasks.create'), ctrl.createTask);

// Task comments & checklist
router.get('/:id/tasks/:taskId/comments', requirePermission('projects.communication.view'), ctrl.getTaskComments);
router.post('/:id/tasks/:taskId/comments', requirePermission('projects.communication.create'), ctrl.createTaskComment);
router.get('/:id/tasks/:taskId/checklist', requirePermission('projects.tasks.view'), ctrl.getTaskChecklist);
router.post('/:id/tasks/:taskId/checklist', requirePermission('projects.tasks.create'), ctrl.createChecklistItem);

// Members
router.get('/:id/members', requirePermission('projects.teams.view'), ctrl.getMembers);
router.post('/:id/members', requirePermission('projects.teams.create'), ctrl.addMember);
router.delete('/:id/members/:memberId', requirePermission('projects.teams.delete'), ctrl.removeMember);

// Milestones
router.get('/:id/milestones', requirePermission('projects.milestones.view'), ctrl.getMilestones);
router.post('/:id/milestones', requirePermission('projects.milestones.create'), ctrl.createMilestone);

// Time tracking
router.get('/:id/time-entries', requirePermission('projects.time.view'), ctrl.getTimeEntries);
router.post('/:id/time-entries', requirePermission('projects.time.create'), ctrl.createTimeEntry);

// Activity feed
router.get('/:id/activities', requirePermission('projects.communication.view'), ctrl.getProjectActivities);

module.exports = router;
