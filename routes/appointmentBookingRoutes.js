/**
 * Appointment Booking Routes - Bisonstechs ERP
 * Mounted at /api/appointments
 * (Scheduling / reservation product — separate from CRM activities.)
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');
const { RateLimiter } = require('../middleware/rateLimiter');
const ctrl = require('../controllers/appointmentBookingController');

// ─── Public booking (NO auth) ────────────────────────────────────────────────
// Company is resolved from ApptBookingSettings.publicSlug (publicEnabled = true).
// Registered BEFORE router.use(protect). Rate-limited per IP.
const publicReadLimiter = new RateLimiter(60 * 1000, 60, 'Too many requests, please try again shortly');
const publicBookLimiter = new RateLimiter(15 * 60 * 1000, 20, 'Too many booking attempts, please try again later');
const limiterCleanup = setInterval(() => {
  publicReadLimiter.cleanup();
  publicBookLimiter.cleanup();
}, 5 * 60 * 1000);
if (typeof limiterCleanup.unref === 'function') limiterCleanup.unref();

router.get('/public/:slug', publicReadLimiter.middleware(), ctrl.getPublicBookingPage);
router.post('/public/:slug/book', publicBookLimiter.middleware(), ctrl.createPublicBooking);

// ─── Authenticated routes ────────────────────────────────────────────────────
router.use(protect);

// Dashboard
router.get('/dashboard', requirePermission('appointments.dashboard.view'), ctrl.getDashboard);

// Types
router.get('/types', requirePermission('appointments.types.view'), ctrl.getTypes);
router.post('/types', requirePermission('appointments.types.create'), ctrl.createType);
router.put('/types/:id', requirePermission('appointments.types.edit'), ctrl.updateType);
router.delete('/types/:id', requirePermission('appointments.types.delete'), ctrl.deleteType);

// Services
router.get('/services', requirePermission('appointments.services.view'), ctrl.getServices);
router.post('/services', requirePermission('appointments.services.create'), ctrl.createService);
router.put('/services/:id', requirePermission('appointments.services.edit'), ctrl.updateService);
router.delete('/services/:id', requirePermission('appointments.services.delete'), ctrl.deleteService);

// Availability (working hours, breaks)
router.get('/availability', requirePermission('appointments.availability.view'), ctrl.getAvailability);
router.post('/availability', requirePermission('appointments.availability.create'), ctrl.createAvailability);
router.delete('/availability/:id', requirePermission('appointments.availability.delete'), ctrl.deleteAvailability);

// Holidays
router.get('/holidays', requirePermission('appointments.availability.view'), ctrl.getHolidays);
router.post('/holidays', requirePermission('appointments.availability.create'), ctrl.createHoliday);
router.delete('/holidays/:id', requirePermission('appointments.availability.delete'), ctrl.deleteHoliday);

// Settings
router.get('/settings', requirePermission('appointments.settings.view'), ctrl.getBookingSettings);
router.put('/settings', requirePermission('appointments.settings.edit'), ctrl.updateBookingSettings);

// Bookings
router.get('/bookings', requirePermission('appointments.bookings.view'), ctrl.getBookings);
router.post('/bookings', requirePermission('appointments.bookings.create'), ctrl.createBooking);
router.get('/bookings/:id', requirePermission('appointments.bookings.view'), ctrl.getBookingById);
router.put('/bookings/:id', requirePermission('appointments.bookings.edit'), ctrl.updateBooking);
router.delete('/bookings/:id', requirePermission('appointments.bookings.delete'), ctrl.deleteBooking);

module.exports = router;
