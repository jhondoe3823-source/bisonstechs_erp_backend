/**
 * Appointment Booking Controller - Bisonstechs ERP (Business Applications Suite)
 * Scheduling / reservation product (NOT CRM activities).
 * Dashboard, types, services, bookings, availability, settings.
 * All queries are scoped by companyId.
 */
const crypto = require('crypto');
const prisma = require('../prisma/client');
const {
  getCompanyId, getUserId, httpError, sendError, parsePagination, clean, parseDate,
  parseIntOr, parseDecimal, pickEnum, assertUserInCompany, startOfDay, endOfDay,
  startOfMonth, groupCountMap, slugify,
} = require('../utils/businessAppsHelpers');

const BOOKING_STATUSES = ['pending', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'];
const INACTIVE_BOOKING_STATUSES = ['cancelled', 'no_show'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const USER_SELECT = { id: true, firstName: true, lastName: true, email: true };

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getSettings(companyId) {
  const s = await prisma.apptBookingSettings.findUnique({ where: { companyId } });
  return s || {
    bufferMinutes: 0, slotIntervalMinutes: 30, requireApproval: false,
    publicSlug: null, publicEnabled: false, reminderMinutesBefore: 60,
  };
}

/** OWN scope → bookings assigned to or created by the user. */
function bookingScopeWhere(req) {
  if (req.permissionScope !== 'OWN') return {};
  const uid = getUserId(req);
  return { OR: [{ userId: uid }, { createdBy: uid }] };
}

async function logActivity({ bookingId, userId, action, message }) {
  try {
    await prisma.apptActivity.create({ data: { bookingId, userId: userId || null, action, message } });
  } catch (e) {
    console.warn('[Appointments] Activity log failed:', e.message);
  }
}

async function findBookingOrThrow(req, companyId, id, extra = {}) {
  const booking = await prisma.apptBooking.findFirst({
    where: { id, companyId, ...bookingScopeWhere(req) },
    ...extra,
  });
  if (!booking) throw httpError(404, 'Booking not found');
  return booking;
}

/** Throws 409 if the assignee already has an overlapping (buffer-aware) booking. */
async function assertNoConflict({ companyId, userId, startsAt, endsAt, excludeId, bufferMinutes }) {
  if (!userId) return;
  const bufferMs = (bufferMinutes || 0) * 60000;
  const clash = await prisma.apptBooking.findFirst({
    where: {
      companyId,
      userId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      status: { notIn: INACTIVE_BOOKING_STATUSES },
      startsAt: { lt: new Date(endsAt.getTime() + bufferMs) },
      endsAt: { gt: new Date(startsAt.getTime() - bufferMs) },
    },
    select: { id: true, startsAt: true, endsAt: true },
  });
  if (clash) {
    throw httpError(409, 'The selected staff member already has a booking in that time slot', 'BOOKING_CONFLICT');
  }
}

async function assertTypeInCompany(typeId, companyId) {
  if (!typeId) return null;
  const t = await prisma.apptType.findFirst({ where: { id: typeId, companyId } });
  if (!t) throw httpError(400, 'Appointment type not found');
  return t;
}

async function assertServiceInCompany(serviceId, companyId) {
  if (!serviceId) return null;
  const s = await prisma.apptService.findFirst({ where: { id: serviceId, companyId } });
  if (!s) throw httpError(400, 'Appointment service not found');
  return s;
}

async function assertCustomerInCompany(customerId, companyId) {
  if (!customerId) return;
  const c = await prisma.customer.findFirst({ where: { id: customerId, companyId }, select: { id: true } });
  if (!c) throw httpError(400, 'Customer does not belong to the active company');
}

function validateTimeRange(startTime, endTime) {
  if (!TIME_RE.test(startTime || '') || !TIME_RE.test(endTime || '')) {
    throw httpError(400, 'startTime and endTime must be in HH:mm format');
  }
  if (endTime <= startTime) throw httpError(400, 'endTime must be after startTime');
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

const getDashboard = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const now = new Date();
    const scope = bookingScopeWhere(req);
    const base = { companyId, ...scope };
    const monthStart = startOfMonth(now);
    const dayStart = startOfDay(now);
    const dayEnd = endOfDay(now);
    const in7Days = new Date(now.getTime() + 7 * 86400000);

    const [
      monthGroups, today, todayActive, upcoming, next7Days, pendingApproval,
      activeServices, activeTypes, todaysSchedule, nextBookings,
    ] = await Promise.all([
      prisma.apptBooking.groupBy({
        by: ['status'], where: { ...base, startsAt: { gte: monthStart } }, _count: { _all: true },
      }),
      prisma.apptBooking.count({ where: { ...base, startsAt: { gte: dayStart, lte: dayEnd } } }),
      prisma.apptBooking.count({
        where: { ...base, startsAt: { gte: dayStart, lte: dayEnd }, status: { notIn: INACTIVE_BOOKING_STATUSES } },
      }),
      prisma.apptBooking.count({
        where: { ...base, startsAt: { gte: now }, status: { in: ['pending', 'confirmed'] } },
      }),
      prisma.apptBooking.count({
        where: { ...base, startsAt: { gte: now, lte: in7Days }, status: { in: ['pending', 'confirmed'] } },
      }),
      prisma.apptBooking.count({ where: { ...base, status: 'pending' } }),
      prisma.apptService.count({ where: { companyId, isActive: true } }),
      prisma.apptType.count({ where: { companyId, isActive: true } }),
      prisma.apptBooking.findMany({
        where: { ...base, startsAt: { gte: dayStart, lte: dayEnd }, status: { notIn: INACTIVE_BOOKING_STATUSES } },
        orderBy: { startsAt: 'asc' },
        take: 20,
        include: {
          service: { select: { id: true, name: true } },
          assignee: { select: USER_SELECT },
        },
      }),
      prisma.apptBooking.findMany({
        where: { ...base, startsAt: { gte: now }, status: { in: ['pending', 'confirmed'] } },
        orderBy: { startsAt: 'asc' },
        take: 5,
        include: {
          service: { select: { id: true, name: true } },
          assignee: { select: USER_SELECT },
        },
      }),
    ]);

    const monthByStatus = groupCountMap(monthGroups, 'status');
    const monthTotal = Object.values(monthByStatus).reduce((a, b) => a + b, 0);

    res.json({
      success: true,
      data: {
        bookings: {
          today,
          todayActive,
          upcoming,
          next7Days,
          pendingApproval,
          thisMonth: {
            total: monthTotal,
            completed: monthByStatus.completed || 0,
            cancelled: monthByStatus.cancelled || 0,
            noShow: monthByStatus.no_show || 0,
            byStatus: monthByStatus,
          },
        },
        catalog: { activeServices, activeTypes },
        todaysSchedule,
        nextBookings,
      },
      message: 'Appointment dashboard loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load appointment dashboard');
  }
};

// ─── Types ───────────────────────────────────────────────────────────────────

const getTypes = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const where = { companyId };
    if (req.query.active === '1') where.isActive = true;
    if (clean(req.query.search)) where.name = { contains: clean(req.query.search), mode: 'insensitive' };
    const types = await prisma.apptType.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { services: true, bookings: true } } },
    });
    res.json({ success: true, data: types, message: 'Appointment types loaded' });
  } catch (err) {
    sendError(res, err, 'Failed to load appointment types');
  }
};

const createType = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const b = req.body || {};
    const name = clean(b.name);
    if (!name) throw httpError(400, 'Type name is required');
    const duration = parseIntOr(b.durationMinutes, 30);
    if (duration <= 0) throw httpError(400, 'durationMinutes must be greater than 0');

    const type = await prisma.apptType.create({
      data: {
        companyId, name,
        description: clean(b.description),
        color: clean(b.color),
        durationMinutes: duration,
        isActive: b.isActive === undefined ? true : Boolean(b.isActive),
      },
    });
    res.status(201).json({ success: true, data: type, message: 'Appointment type created' });
  } catch (err) {
    sendError(res, err, 'Failed to create appointment type');
  }
};

const updateType = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const b = req.body || {};
    const existing = await assertTypeInCompany(req.params.id, companyId);
    if (!existing) throw httpError(404, 'Appointment type not found');

    const data = {};
    if (b.name !== undefined) {
      const name = clean(b.name);
      if (!name) throw httpError(400, 'Type name cannot be empty');
      data.name = name;
    }
    if (b.description !== undefined) data.description = clean(b.description);
    if (b.color !== undefined) data.color = clean(b.color);
    if (b.durationMinutes !== undefined) {
      const d = parseIntOr(b.durationMinutes, 0);
      if (d <= 0) throw httpError(400, 'durationMinutes must be greater than 0');
      data.durationMinutes = d;
    }
    if (b.isActive !== undefined) data.isActive = Boolean(b.isActive);

    const type = await prisma.apptType.update({ where: { id: existing.id }, data });
    res.json({ success: true, data: type, message: 'Appointment type updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update appointment type');
  }
};

/** Deletes the type; if it is still referenced by services/bookings it is deactivated instead. */
const deleteType = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing = await assertTypeInCompany(req.params.id, companyId);
    if (!existing) throw httpError(404, 'Appointment type not found');

    const [services, bookings] = await Promise.all([
      prisma.apptService.count({ where: { typeId: existing.id } }),
      prisma.apptBooking.count({ where: { typeId: existing.id } }),
    ]);
    if (services || bookings) {
      await prisma.apptType.update({ where: { id: existing.id }, data: { isActive: false } });
      return res.json({
        success: true, data: { id: existing.id, deactivated: true },
        message: 'Type is in use and was deactivated instead of deleted',
      });
    }
    await prisma.apptType.delete({ where: { id: existing.id } });
    res.json({ success: true, data: { id: existing.id, deleted: true }, message: 'Appointment type deleted' });
  } catch (err) {
    sendError(res, err, 'Failed to delete appointment type');
  }
};

// ─── Services ────────────────────────────────────────────────────────────────

async function resolveAssignees(raw, companyId) {
  if (raw === undefined) return undefined;
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map(clean).filter(Boolean))];
  for (const id of ids) await assertUserInCompany(id, companyId, 'Assignee');
  return ids;
}

const getServices = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const where = { companyId };
    if (req.query.active === '1') where.isActive = true;
    if (clean(req.query.typeId)) where.typeId = clean(req.query.typeId);
    if (clean(req.query.search)) where.name = { contains: clean(req.query.search), mode: 'insensitive' };
    const services = await prisma.apptService.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        type: { select: { id: true, name: true, color: true } },
        assignees: { include: { user: { select: USER_SELECT } } },
        _count: { select: { bookings: true } },
      },
    });
    res.json({ success: true, data: services, message: 'Appointment services loaded' });
  } catch (err) {
    sendError(res, err, 'Failed to load appointment services');
  }
};

const createService = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const b = req.body || {};
    const name = clean(b.name);
    if (!name) throw httpError(400, 'Service name is required');
    const duration = parseIntOr(b.durationMinutes, 30);
    if (duration <= 0) throw httpError(400, 'durationMinutes must be greater than 0');
    const typeId = clean(b.typeId);
    await assertTypeInCompany(typeId, companyId);
    const assigneeIds = (await resolveAssignees(b.assigneeIds, companyId)) || [];
    const price = b.price === undefined || b.price === null || b.price === '' ? null : parseDecimal(b.price);

    const service = await prisma.apptService.create({
      data: {
        companyId, name,
        description: clean(b.description),
        durationMinutes: duration,
        price,
        typeId,
        isActive: b.isActive === undefined ? true : Boolean(b.isActive),
        assignees: { create: assigneeIds.map((userId) => ({ userId })) },
      },
      include: { assignees: true, type: { select: { id: true, name: true } } },
    });
    res.status(201).json({ success: true, data: service, message: 'Appointment service created' });
  } catch (err) {
    sendError(res, err, 'Failed to create appointment service');
  }
};

const updateService = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const b = req.body || {};
    const existing = await assertServiceInCompany(req.params.id, companyId);
    if (!existing) throw httpError(404, 'Appointment service not found');

    const data = {};
    if (b.name !== undefined) {
      const name = clean(b.name);
      if (!name) throw httpError(400, 'Service name cannot be empty');
      data.name = name;
    }
    if (b.description !== undefined) data.description = clean(b.description);
    if (b.durationMinutes !== undefined) {
      const d = parseIntOr(b.durationMinutes, 0);
      if (d <= 0) throw httpError(400, 'durationMinutes must be greater than 0');
      data.durationMinutes = d;
    }
    if (b.price !== undefined) data.price = b.price === null || b.price === '' ? null : parseDecimal(b.price);
    if (b.typeId !== undefined) {
      const typeId = clean(b.typeId);
      await assertTypeInCompany(typeId, companyId);
      data.typeId = typeId;
    }
    if (b.isActive !== undefined) data.isActive = Boolean(b.isActive);
    const assigneeIds = await resolveAssignees(b.assigneeIds, companyId);

    const service = await prisma.$transaction(async (tx) => {
      if (assigneeIds) {
        await tx.apptServiceAssignee.deleteMany({ where: { serviceId: existing.id } });
        if (assigneeIds.length) {
          await tx.apptServiceAssignee.createMany({
            data: assigneeIds.map((userId) => ({ serviceId: existing.id, userId })),
          });
        }
      }
      return tx.apptService.update({
        where: { id: existing.id },
        data,
        include: { assignees: true, type: { select: { id: true, name: true } } },
      });
    });
    res.json({ success: true, data: service, message: 'Appointment service updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update appointment service');
  }
};

/** Deletes the service; if referenced by bookings it is deactivated instead. */
const deleteService = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing = await assertServiceInCompany(req.params.id, companyId);
    if (!existing) throw httpError(404, 'Appointment service not found');

    const bookings = await prisma.apptBooking.count({ where: { serviceId: existing.id } });
    if (bookings) {
      await prisma.apptService.update({ where: { id: existing.id }, data: { isActive: false } });
      return res.json({
        success: true, data: { id: existing.id, deactivated: true },
        message: 'Service is in use and was deactivated instead of deleted',
      });
    }
    await prisma.apptService.delete({ where: { id: existing.id } });
    res.json({ success: true, data: { id: existing.id, deleted: true }, message: 'Appointment service deleted' });
  } catch (err) {
    sendError(res, err, 'Failed to delete appointment service');
  }
};

// ─── Bookings ────────────────────────────────────────────────────────────────

const BOOKING_INCLUDE = {
  service: { select: { id: true, name: true, durationMinutes: true, price: true } },
  type: { select: { id: true, name: true, color: true } },
  assignee: { select: USER_SELECT },
  customer: { select: { id: true, name: true, email: true, phone: true } },
};

const getBookings = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { search, status, userId, serviceId, typeId, customerId, from, to, sortDir = 'asc' } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const where = { companyId, ...bookingScopeWhere(req) };
    if (clean(status)) where.status = clean(status);
    if (clean(userId)) where.userId = clean(userId);
    if (clean(serviceId)) where.serviceId = clean(serviceId);
    if (clean(typeId)) where.typeId = clean(typeId);
    if (clean(customerId)) where.customerId = clean(customerId);
    const fromD = parseDate(clean(from) || undefined, 'from date');
    const toD = parseDate(clean(to) || undefined, 'to date');
    if (fromD || toD) {
      where.startsAt = {};
      if (fromD) where.startsAt.gte = fromD;
      if (toD) where.startsAt.lte = toD;
    }
    if (clean(search)) {
      const q = clean(search);
      const searchOr = [
        { customerName: { contains: q, mode: 'insensitive' } },
        { customerEmail: { contains: q, mode: 'insensitive' } },
        { customerPhone: { contains: q, mode: 'insensitive' } },
      ];
      where.AND = [{ OR: searchOr }];
    }

    const [bookings, total] = await Promise.all([
      prisma.apptBooking.findMany({
        where,
        orderBy: { startsAt: sortDir === 'desc' ? 'desc' : 'asc' },
        skip,
        take: limit,
        include: BOOKING_INCLUDE,
      }),
      prisma.apptBooking.count({ where }),
    ]);

    res.json({
      success: true,
      data: bookings,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      message: 'Bookings loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load bookings');
  }
};

const getBookingById = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const booking = await findBookingOrThrow(req, companyId, req.params.id, {
      include: {
        ...BOOKING_INCLUDE,
        creator: { select: USER_SELECT },
        activities: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    res.json({ success: true, data: booking, message: 'Booking loaded' });
  } catch (err) {
    sendError(res, err, 'Failed to load booking');
  }
};

const createBooking = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const b = req.body || {};

    const customerName = clean(b.customerName);
    if (!customerName) throw httpError(400, 'Customer name is required');
    const startsAt = parseDate(b.startsAt, 'start time');
    if (!startsAt) throw httpError(400, 'Start time is required');

    const service = await assertServiceInCompany(clean(b.serviceId), companyId);
    const typeId = clean(b.typeId) || service?.typeId || null;
    const type = await assertTypeInCompany(typeId, companyId);
    const assigneeId = clean(b.userId);
    await assertUserInCompany(assigneeId, companyId, 'Assignee');
    const customerId = clean(b.customerId);
    await assertCustomerInCompany(customerId, companyId);

    let endsAt = parseDate(b.endsAt, 'end time');
    if (!endsAt) {
      const duration = parseIntOr(b.durationMinutes, 0) || service?.durationMinutes || type?.durationMinutes || 30;
      endsAt = new Date(startsAt.getTime() + duration * 60000);
    }
    if (endsAt <= startsAt) throw httpError(400, 'End time must be after start time');

    const settings = await getSettings(companyId);
    await assertNoConflict({
      companyId, userId: assigneeId, startsAt, endsAt, bufferMinutes: settings.bufferMinutes,
    });

    const status = pickEnum(b.status, BOOKING_STATUSES, 'status')
      || (settings.requireApproval ? 'pending' : 'confirmed');

    const booking = await prisma.apptBooking.create({
      data: {
        companyId,
        serviceId: service?.id || null,
        typeId: type?.id || null,
        userId: assigneeId,
        customerId,
        customerName,
        customerEmail: clean(b.customerEmail),
        customerPhone: clean(b.customerPhone),
        startsAt,
        endsAt,
        status,
        location: clean(b.location),
        meetingLink: clean(b.meetingLink),
        notes: clean(b.notes),
        publicToken: crypto.randomBytes(16).toString('hex'),
        createdBy: userId,
      },
      include: BOOKING_INCLUDE,
    });

    await logActivity({
      bookingId: booking.id, userId, action: 'booking_created',
      message: `Booking created for ${booking.customerName} (${status})`,
    });

    res.status(201).json({ success: true, data: booking, message: 'Booking created' });
  } catch (err) {
    sendError(res, err, 'Failed to create booking');
  }
};

const updateBooking = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const b = req.body || {};
    const existing = await findBookingOrThrow(req, companyId, req.params.id);

    const data = {};
    if (b.customerName !== undefined) {
      const customerName = clean(b.customerName);
      if (!customerName) throw httpError(400, 'Customer name cannot be empty');
      data.customerName = customerName;
    }
    if (b.customerEmail !== undefined) data.customerEmail = clean(b.customerEmail);
    if (b.customerPhone !== undefined) data.customerPhone = clean(b.customerPhone);
    if (b.location !== undefined) data.location = clean(b.location);
    if (b.meetingLink !== undefined) data.meetingLink = clean(b.meetingLink);
    if (b.notes !== undefined) data.notes = clean(b.notes);
    if (b.serviceId !== undefined) {
      const serviceId = clean(b.serviceId);
      await assertServiceInCompany(serviceId, companyId);
      data.serviceId = serviceId;
    }
    if (b.typeId !== undefined) {
      const typeId = clean(b.typeId);
      await assertTypeInCompany(typeId, companyId);
      data.typeId = typeId;
    }
    if (b.customerId !== undefined) {
      const customerId = clean(b.customerId);
      await assertCustomerInCompany(customerId, companyId);
      data.customerId = customerId;
    }
    if (b.userId !== undefined) {
      const assigneeId = clean(b.userId);
      await assertUserInCompany(assigneeId, companyId, 'Assignee');
      data.userId = assigneeId;
    }
    if (b.status !== undefined) data.status = pickEnum(b.status, BOOKING_STATUSES, 'status');

    const startsAt = b.startsAt !== undefined ? parseDate(b.startsAt, 'start time') : existing.startsAt;
    if (!startsAt) throw httpError(400, 'Start time cannot be empty');
    let endsAt = b.endsAt !== undefined ? parseDate(b.endsAt, 'end time') : null;
    if (!endsAt) {
      const keepDuration = existing.endsAt.getTime() - existing.startsAt.getTime();
      endsAt = b.endsAt !== undefined || b.startsAt === undefined ? existing.endsAt : new Date(startsAt.getTime() + keepDuration);
    }
    if (endsAt <= startsAt) throw httpError(400, 'End time must be after start time');

    const timeChanged = startsAt.getTime() !== existing.startsAt.getTime() || endsAt.getTime() !== existing.endsAt.getTime();
    if (timeChanged) {
      data.startsAt = startsAt;
      data.endsAt = endsAt;
    }

    const effStatus = data.status || existing.status;
    const effAssignee = data.userId !== undefined ? data.userId : existing.userId;
    const needsCheck = !INACTIVE_BOOKING_STATUSES.includes(effStatus)
      && (timeChanged || data.userId !== undefined || INACTIVE_BOOKING_STATUSES.includes(existing.status));
    if (needsCheck) {
      const settings = await getSettings(companyId);
      await assertNoConflict({
        companyId, userId: effAssignee, startsAt, endsAt,
        excludeId: existing.id, bufferMinutes: settings.bufferMinutes,
      });
    }

    const booking = await prisma.apptBooking.update({
      where: { id: existing.id },
      data,
      include: BOOKING_INCLUDE,
    });

    const statusChanged = data.status && data.status !== existing.status;
    await logActivity({
      bookingId: existing.id, userId,
      action: statusChanged ? `status_${data.status}` : (timeChanged ? 'rescheduled' : 'booking_updated'),
      message: statusChanged
        ? `Status changed from ${existing.status} to ${data.status}`
        : (timeChanged ? 'Booking rescheduled' : 'Booking updated'),
    });

    res.json({ success: true, data: booking, message: 'Booking updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update booking');
  }
};

const deleteBooking = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing = await findBookingOrThrow(req, companyId, req.params.id, { select: { id: true } });
    await prisma.apptBooking.delete({ where: { id: existing.id } }); // activities cascade
    res.json({ success: true, data: { id: existing.id }, message: 'Booking deleted' });
  } catch (err) {
    sendError(res, err, 'Failed to delete booking');
  }
};

// ─── Availability ────────────────────────────────────────────────────────────

const getAvailability = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const where = { companyId };
    const uid = clean(req.query.userId);
    if (req.permissionScope === 'OWN') where.userId = { in: [getUserId(req), null] };
    else if (uid) where.userId = uid;
    if (req.query.dayOfWeek !== undefined && clean(req.query.dayOfWeek) !== null) {
      where.dayOfWeek = parseIntOr(req.query.dayOfWeek, 0);
    }

    const holidayWhere = { companyId, date: { gte: startOfDay() } };
    if (where.userId) holidayWhere.userId = where.userId;

    const [availability, holidays] = await Promise.all([
      prisma.apptAvailability.findMany({
        where,
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        include: { user: { select: USER_SELECT } },
      }),
      prisma.apptHoliday.findMany({ where: holidayWhere, orderBy: { date: 'asc' }, take: 100 }),
    ]);

    res.json({ success: true, data: { availability, holidays }, message: 'Availability loaded' });
  } catch (err) {
    sendError(res, err, 'Failed to load availability');
  }
};

const createAvailability = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const b = req.body || {};
    const dayOfWeek = parseIntOr(b.dayOfWeek, -1);
    if (dayOfWeek < 0 || dayOfWeek > 6) throw httpError(400, 'dayOfWeek must be between 0 (Sunday) and 6 (Saturday)');
    validateTimeRange(b.startTime, b.endTime);
    let userId = clean(b.userId);
    if (req.permissionScope === 'OWN') userId = getUserId(req);
    await assertUserInCompany(userId, companyId, 'User');

    const slot = await prisma.apptAvailability.create({
      data: {
        companyId, userId, dayOfWeek,
        startTime: b.startTime, endTime: b.endTime,
        isBreak: Boolean(b.isBreak),
      },
    });
    res.status(201).json({ success: true, data: slot, message: 'Availability slot created' });
  } catch (err) {
    sendError(res, err, 'Failed to create availability slot');
  }
};

const deleteAvailability = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const slot = await prisma.apptAvailability.findFirst({ where: { id: req.params.id, companyId } });
    if (!slot) throw httpError(404, 'Availability slot not found');
    if (req.permissionScope === 'OWN' && slot.userId !== getUserId(req)) {
      throw httpError(403, 'Access denied. Your access is restricted to OWN records only.');
    }
    await prisma.apptAvailability.delete({ where: { id: slot.id } });
    res.json({ success: true, data: { id: slot.id }, message: 'Availability slot deleted' });
  } catch (err) {
    sendError(res, err, 'Failed to delete availability slot');
  }
};

// ─── Settings ────────────────────────────────────────────────────────────────

const getBookingSettings = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    res.json({ success: true, data: await getSettings(companyId), message: 'Appointment settings loaded' });
  } catch (err) {
    sendError(res, err, 'Failed to load appointment settings');
  }
};

const updateBookingSettings = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const b = req.body || {};
    const data = {};
    if (b.bufferMinutes !== undefined) {
      data.bufferMinutes = parseIntOr(b.bufferMinutes, -1);
      if (data.bufferMinutes < 0) throw httpError(400, 'bufferMinutes must be 0 or more');
    }
    if (b.slotIntervalMinutes !== undefined) {
      data.slotIntervalMinutes = parseIntOr(b.slotIntervalMinutes, 0);
      if (data.slotIntervalMinutes < 5) throw httpError(400, 'slotIntervalMinutes must be at least 5');
    }
    if (b.reminderMinutesBefore !== undefined) {
      data.reminderMinutesBefore = parseIntOr(b.reminderMinutesBefore, -1);
      if (data.reminderMinutesBefore < 0) throw httpError(400, 'reminderMinutesBefore must be 0 or more');
    }
    if (b.requireApproval !== undefined) data.requireApproval = Boolean(b.requireApproval);
    if (b.publicEnabled !== undefined) data.publicEnabled = Boolean(b.publicEnabled);
    if (b.publicSlug !== undefined) {
      const slug = clean(b.publicSlug) ? slugify(b.publicSlug) : null;
      if (slug) {
        const dup = await prisma.apptBookingSettings.findFirst({
          where: { publicSlug: slug, companyId: { not: companyId } }, select: { id: true },
        });
        if (dup) throw httpError(409, 'Public booking URL is already taken');
      }
      data.publicSlug = slug;
    }

    const settings = await prisma.apptBookingSettings.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
    res.json({ success: true, data: settings, message: 'Appointment settings updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update appointment settings');
  }
};

// ─── Holidays (appointments.availability.*) ──────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Holiday dates are stored as DATE (UTC midnight). Accepts 'YYYY-MM-DD' or any parsable date. */
function parseHolidayDate(value) {
  if (!value) throw httpError(400, 'date is required');
  const s = String(value).trim();
  if (DATE_RE.test(s)) {
    const d = new Date(`${s}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw httpError(400, 'Invalid date');
    return d;
  }
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) throw httpError(400, 'Invalid date');
  return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
}

const getHolidays = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const where = { companyId };
    const uid = clean(req.query.userId);
    if (req.permissionScope === 'OWN') where.userId = { in: [getUserId(req), null] };
    else if (uid) where.userId = uid;

    const fromRaw = clean(req.query.from);
    const toRaw = clean(req.query.to);
    const range = {};
    if (fromRaw) range.gte = parseHolidayDate(fromRaw);
    else if (req.query.includePast !== '1') range.gte = parseHolidayDate(new Date().toISOString().slice(0, 10));
    if (toRaw) range.lte = parseHolidayDate(toRaw);
    if (Object.keys(range).length) where.date = range;

    const holidays = await prisma.apptHoliday.findMany({
      where,
      orderBy: { date: 'asc' },
      take: 500,
      include: { user: { select: USER_SELECT } },
    });
    res.json({ success: true, data: holidays, message: 'Holidays loaded' });
  } catch (err) {
    sendError(res, err, 'Failed to load holidays');
  }
};

const createHoliday = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const b = req.body || {};
    const date = parseHolidayDate(b.date);
    let userId = clean(b.userId);
    if (req.permissionScope === 'OWN') userId = getUserId(req);
    await assertUserInCompany(userId, companyId, 'User');

    const dup = await prisma.apptHoliday.findFirst({
      where: { companyId, date, userId: userId || null }, select: { id: true },
    });
    if (dup) throw httpError(409, 'A holiday already exists for that date');

    const holiday = await prisma.apptHoliday.create({
      data: { companyId, date, name: clean(b.name), userId: userId || null },
    });
    res.status(201).json({ success: true, data: holiday, message: 'Holiday created' });
  } catch (err) {
    sendError(res, err, 'Failed to create holiday');
  }
};

const deleteHoliday = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const holiday = await prisma.apptHoliday.findFirst({ where: { id: req.params.id, companyId } });
    if (!holiday) throw httpError(404, 'Holiday not found');
    if (req.permissionScope === 'OWN' && holiday.userId !== getUserId(req)) {
      throw httpError(403, 'Access denied. Your access is restricted to OWN records only.');
    }
    await prisma.apptHoliday.delete({ where: { id: holiday.id } });
    res.json({ success: true, data: { id: holiday.id }, message: 'Holiday deleted' });
  } catch (err) {
    sendError(res, err, 'Failed to delete holiday');
  }
};

// ─── Public booking (no auth; company resolved via ApptBookingSettings.publicSlug) ──

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

/** 'YYYY-MM-DD' → local-midnight Date (availability HH:mm values are interpreted in server-local time). */
function localDayStart(dateStr) {
  if (!DATE_RE.test(dateStr || '')) throw httpError(400, 'date must be in YYYY-MM-DD format');
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  if (Number.isNaN(dt.getTime()) || dt.getDate() !== d) throw httpError(400, 'Invalid date');
  return dt;
}

function localDateString(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function resolvePublicCompany(slug) {
  const key = clean(slug)?.toLowerCase();
  if (!key) throw httpError(404, 'Booking page not found');
  const settings = await prisma.apptBookingSettings.findFirst({
    where: { publicSlug: key, publicEnabled: true },
  });
  if (!settings) throw httpError(404, 'Booking page not found');
  const company = await prisma.company.findUnique({
    where: { id: settings.companyId },
    select: { id: true, name: true, isActive: true },
  });
  if (!company || company.isActive === false) throw httpError(404, 'Booking page not found');
  return { settings, company };
}

async function loadPublicService(companyId, serviceId) {
  const id = clean(serviceId);
  if (!id) throw httpError(400, 'serviceId is required');
  const service = await prisma.apptService.findFirst({
    where: { id, companyId, isActive: true },
    include: { assignees: { select: { userId: true } } },
  });
  if (!service) throw httpError(404, 'Service not found');
  return service;
}

/**
 * Compute bookable slots for a service on a given day.
 * Honors working hours (staff-specific rows override company-wide rows), breaks, holidays,
 * slot interval, buffer, existing bookings, and "not in the past".
 * Returns [{ startsAt, endsAt, staffIds }] where staffIds may contain null (company-level, unassigned).
 */
async function computeSlots({ companyId, settings, service, dateStr, staffUserId }) {
  const dayStart = localDayStart(dateStr);
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const dow = dayStart.getDay();
  const duration = service.durationMinutes || 30;
  const interval = Math.max(5, settings.slotIntervalMinutes || 30);
  const bufferMs = (settings.bufferMinutes || 0) * 60000;
  const now = new Date();

  const assigneeIds = service.assignees.map((a) => a.userId);
  let candidates;
  if (staffUserId) {
    if (assigneeIds.length && !assigneeIds.includes(staffUserId)) {
      throw httpError(400, 'Selected staff member does not provide this service');
    }
    candidates = [staffUserId];
  } else {
    candidates = assigneeIds.length ? assigneeIds : [null];
  }

  const holidayDate = new Date(Date.UTC(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate()));
  const [holidays, availabilityRows, bookings] = await Promise.all([
    prisma.apptHoliday.findMany({ where: { companyId, date: holidayDate }, select: { userId: true } }),
    prisma.apptAvailability.findMany({ where: { companyId, dayOfWeek: dow } }),
    prisma.apptBooking.findMany({
      where: {
        companyId,
        status: { notIn: INACTIVE_BOOKING_STATUSES },
        startsAt: { lt: new Date(dayEnd.getTime() + bufferMs) },
        endsAt: { gt: new Date(dayStart.getTime() - bufferMs) },
      },
      select: { userId: true, startsAt: true, endsAt: true },
    }),
  ]);

  if (holidays.some((h) => !h.userId)) return []; // company-wide holiday
  const closedStaff = new Set(holidays.filter((h) => h.userId).map((h) => h.userId));

  const rowsFor = (c) => {
    const own = c ? availabilityRows.filter((r) => r.userId === c) : [];
    return own.length ? own : availabilityRows.filter((r) => !r.userId);
  };

  const slots = new Map(); // startMs → { startsAt, endsAt, staffIds }
  for (const c of candidates) {
    if (c && closedStaff.has(c)) continue;
    const rows = rowsFor(c);
    const windows = rows.filter((r) => !r.isBreak).map((r) => [toMinutes(r.startTime), toMinutes(r.endTime)]);
    const breaks = rows.filter((r) => r.isBreak).map((r) => [toMinutes(r.startTime), toMinutes(r.endTime)]);
    const staffBookings = bookings.filter((b) => (b.userId || null) === (c || null));

    for (const [wStart, wEnd] of windows) {
      for (let s = wStart; s + duration <= wEnd; s += interval) {
        const startsAt = new Date(dayStart.getTime() + s * 60000);
        if (startsAt <= now) continue;
        const endsAt = new Date(startsAt.getTime() + duration * 60000);
        if (breaks.some(([bs, be]) => s < be && s + duration > bs)) continue;
        const clash = staffBookings.some(
          (b) => b.startsAt.getTime() < endsAt.getTime() + bufferMs && b.endsAt.getTime() > startsAt.getTime() - bufferMs,
        );
        if (clash) continue;
        const key = startsAt.getTime();
        if (!slots.has(key)) slots.set(key, { startsAt, endsAt, staffIds: [] });
        slots.get(key).staffIds.push(c || null);
      }
    }
  }
  return [...slots.values()].sort((a, b) => a.startsAt - b.startsAt);
}

/** Unassigned (userId = null) bookings are treated as a single company-level resource. */
async function assertNoUnassignedConflict({ companyId, startsAt, endsAt, bufferMinutes }) {
  const bufferMs = (bufferMinutes || 0) * 60000;
  const clash = await prisma.apptBooking.findFirst({
    where: {
      companyId,
      userId: null,
      status: { notIn: INACTIVE_BOOKING_STATUSES },
      startsAt: { lt: new Date(endsAt.getTime() + bufferMs) },
      endsAt: { gt: new Date(startsAt.getTime() - bufferMs) },
    },
    select: { id: true },
  });
  if (clash) throw httpError(409, 'That time slot is no longer available', 'BOOKING_CONFLICT');
}

/** GET /public/:slug[?date=YYYY-MM-DD&serviceId=..&userId=..] */
const getPublicBookingPage = async (req, res) => {
  try {
    const { settings, company } = await resolvePublicCompany(req.params.slug);
    const companyId = company.id;

    const [services, availability, holidays] = await Promise.all([
      prisma.apptService.findMany({
        where: { companyId, isActive: true },
        orderBy: { name: 'asc' },
        select: {
          id: true, name: true, description: true, durationMinutes: true, price: true,
          type: { select: { id: true, name: true, color: true } },
          assignees: { select: { user: { select: { id: true, firstName: true, lastName: true } } } },
        },
      }),
      prisma.apptAvailability.findMany({
        where: { companyId },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        select: { id: true, userId: true, dayOfWeek: true, startTime: true, endTime: true, isBreak: true },
      }),
      prisma.apptHoliday.findMany({
        where: { companyId, date: { gte: new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) } },
        orderBy: { date: 'asc' },
        take: 100,
        select: { id: true, date: true, name: true, userId: true },
      }),
    ]);

    const data = {
      business: { name: company.name, slug: settings.publicSlug },
      settings: {
        slotIntervalMinutes: settings.slotIntervalMinutes,
        bufferMinutes: settings.bufferMinutes,
        requireApproval: settings.requireApproval,
      },
      services: services.map((s) => ({
        ...s,
        staff: s.assignees.map((a) => a.user),
        assignees: undefined,
      })),
      availability,
      holidays,
      slots: null,
    };

    const dateStr = clean(req.query.date);
    if (dateStr) {
      const service = await loadPublicService(companyId, req.query.serviceId);
      const slots = await computeSlots({
        companyId, settings, service, dateStr, staffUserId: clean(req.query.userId),
      });
      data.slots = {
        date: dateStr,
        serviceId: service.id,
        durationMinutes: service.durationMinutes,
        items: slots.map((s) => ({
          startsAt: s.startsAt, endsAt: s.endsAt, staffIds: s.staffIds.filter(Boolean),
        })),
      };
    }

    res.json({ success: true, data, message: 'Public booking page loaded' });
  } catch (err) {
    sendError(res, err, 'Failed to load booking page');
  }
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** POST /public/:slug/book — pending/confirmed depending on settings.requireApproval. */
const createPublicBooking = async (req, res) => {
  try {
    const { settings, company } = await resolvePublicCompany(req.params.slug);
    const companyId = company.id;
    const b = req.body || {};

    const customerName = clean(b.customerName);
    if (!customerName) throw httpError(400, 'Your name is required');
    if (customerName.length > 200) throw httpError(400, 'Name is too long');
    const customerEmail = clean(b.customerEmail);
    const customerPhone = clean(b.customerPhone);
    if (!customerEmail && !customerPhone) throw httpError(400, 'Provide an email address or phone number');
    if (customerEmail && !EMAIL_RE.test(customerEmail)) throw httpError(400, 'Invalid email address');
    const notes = clean(b.notes);
    if (notes && notes.length > 2000) throw httpError(400, 'Notes are too long');

    const service = await loadPublicService(companyId, b.serviceId);
    const startsAt = parseDate(b.startsAt, 'start time');
    if (!startsAt) throw httpError(400, 'Start time is required');
    if (startsAt <= new Date()) throw httpError(400, 'Start time must be in the future');
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60000);

    // The requested start must be one of the genuinely open slots for that day.
    const slots = await computeSlots({
      companyId, settings, service, dateStr: localDateString(startsAt), staffUserId: clean(b.userId),
    });
    const slot = slots.find((s) => s.startsAt.getTime() === startsAt.getTime());
    if (!slot) throw httpError(409, 'That time slot is not available. Please choose another.', 'SLOT_UNAVAILABLE');

    const assigneeId = slot.staffIds[0] || null;
    if (assigneeId) {
      await assertNoConflict({ companyId, userId: assigneeId, startsAt, endsAt, bufferMinutes: settings.bufferMinutes });
    } else {
      await assertNoUnassignedConflict({ companyId, startsAt, endsAt, bufferMinutes: settings.bufferMinutes });
    }

    const status = settings.requireApproval ? 'pending' : 'confirmed';
    const booking = await prisma.apptBooking.create({
      data: {
        companyId,
        serviceId: service.id,
        typeId: service.typeId || null,
        userId: assigneeId,
        customerName,
        customerEmail,
        customerPhone,
        startsAt,
        endsAt,
        status,
        notes,
        publicToken: crypto.randomBytes(16).toString('hex'),
        createdBy: null,
      },
      include: { service: { select: { id: true, name: true, durationMinutes: true } } },
    });

    await logActivity({
      bookingId: booking.id, userId: null, action: 'public_booking_created',
      message: `Public booking created by ${customerName} (${status})`,
    });

    res.status(201).json({
      success: true,
      data: {
        id: booking.id,
        status: booking.status,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        service: booking.service,
        customerName: booking.customerName,
        publicToken: booking.publicToken,
        requiresApproval: settings.requireApproval,
      },
      message: settings.requireApproval
        ? 'Booking request received. You will be notified once it is confirmed.'
        : 'Booking confirmed',
    });
  } catch (err) {
    sendError(res, err, 'Failed to create booking');
  }
};

module.exports = {
  getDashboard,
  getTypes, createType, updateType, deleteType,
  getServices, createService, updateService, deleteService,
  getBookings, getBookingById, createBooking, updateBooking, deleteBooking,
  getAvailability, createAvailability, deleteAvailability,
  getBookingSettings, updateBookingSettings,
  getHolidays, createHoliday, deleteHoliday,
  getPublicBookingPage, createPublicBooking,
};
