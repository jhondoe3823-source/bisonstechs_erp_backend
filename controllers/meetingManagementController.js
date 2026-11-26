/**
 * Meeting Management Controller - Bisonstechs ERP (Business Applications Suite)
 * Dashboard, meetings CRUD, participants.
 * All queries are scoped by companyId.
 */
const prisma = require('../prisma/client');
const {
  getCompanyId, getUserId, httpError, sendError, parsePagination, clean, parseDate,
  pickEnum, assertUserInCompany, startOfDay, endOfDay, startOfMonth, groupCountMap,
} = require('../utils/businessAppsHelpers');

const MEETING_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];
const MEETING_TYPES = ['internal', 'client', 'board', 'standup', 'review', 'training', 'other'];
const RESPONSES = ['pending', 'accepted', 'rejected', 'tentative'];

const USER_SELECT = { id: true, firstName: true, lastName: true, email: true };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** OWN / TEAM scope → meetings user organizes, created, or is invited to. */
function meetingScopeWhere(req) {
  const scope = req.permissionScope;
  if (scope !== 'OWN' && scope !== 'TEAM') return {};
  const uid = getUserId(req);
  return {
    OR: [
      { organizerId: uid },
      { createdBy: uid },
      { participants: { some: { userId: uid } } },
    ],
  };
}

async function logActivity({ meetingId, userId, action, message }) {
  try {
    await prisma.mtgActivity.create({ data: { meetingId, userId, action, message } });
  } catch (e) {
    console.warn('[Meetings] Activity log failed:', e.message);
  }
}

async function findMeetingOrThrow(req, companyId, id, extra = {}) {
  const meeting = await prisma.mtgMeeting.findFirst({
    where: { id, companyId, ...meetingScopeWhere(req) },
    ...extra,
  });
  if (!meeting) throw httpError(404, 'Meeting not found');
  return meeting;
}

/** Resolve starts/ends/duration into a consistent triple. */
function resolveSchedule({ startsAt, endsAt, durationMinutes }, fallbackDuration = 60) {
  if (!startsAt) throw httpError(400, 'Start time is required');
  let duration = parseInt(durationMinutes, 10);
  let end = endsAt || null;
  if (end) {
    if (end <= startsAt) throw httpError(400, 'End time must be after start time');
    duration = Math.round((end.getTime() - startsAt.getTime()) / 60000);
  } else {
    if (!Number.isFinite(duration) || duration <= 0) duration = fallbackDuration;
    end = new Date(startsAt.getTime() + duration * 60000);
  }
  return { startsAt, endsAt: end, durationMinutes: duration };
}

async function buildParticipants(body, companyId, organizerId) {
  const rows = new Map(); // key → row
  const userIds = Array.isArray(body.participantIds) ? body.participantIds.map(clean).filter(Boolean) : [];
  for (const uid of userIds) {
    await assertUserInCompany(uid, companyId, 'Participant');
    rows.set(`u:${uid}`, { userId: uid, response: uid === organizerId ? 'accepted' : 'pending' });
  }
  if (organizerId && !rows.has(`u:${organizerId}`)) {
    rows.set(`u:${organizerId}`, { userId: organizerId, response: 'accepted' });
  }
  const guests = Array.isArray(body.guests) ? body.guests : [];
  for (const g of guests) {
    const guestName = clean(g?.name ?? g?.guestName);
    const guestEmail = clean(g?.email ?? g?.guestEmail);
    if (!guestName && !guestEmail) continue;
    rows.set(`g:${(guestEmail || guestName).toLowerCase()}`, { guestName, guestEmail, response: 'pending' });
  }
  return [...rows.values()];
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

const getDashboard = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const now = new Date();
    const scopeWhere = meetingScopeWhere(req);
    const base = { companyId, ...scopeWhere };
    const actionBase = { meeting: { companyId, ...scopeWhere } };
    const in7Days = new Date(now.getTime() + 7 * 86400000);

    const [
      statusGroups, today, upcoming, next7Days, completedThisMonth,
      openActions, overdueActions, myOpenActions, myPendingInvites, nextMeetings,
    ] = await Promise.all([
      prisma.mtgMeeting.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      prisma.mtgMeeting.count({
        where: { ...base, startsAt: { gte: startOfDay(now), lte: endOfDay(now) }, status: { not: 'cancelled' } },
      }),
      prisma.mtgMeeting.count({ where: { ...base, startsAt: { gte: now }, status: 'scheduled' } }),
      prisma.mtgMeeting.count({
        where: { ...base, startsAt: { gte: now, lte: in7Days }, status: 'scheduled' },
      }),
      prisma.mtgMeeting.count({
        where: { ...base, status: 'completed', startsAt: { gte: startOfMonth(now) } },
      }),
      prisma.mtgActionItem.count({ where: { ...actionBase, status: { in: ['open', 'in_progress'] } } }),
      prisma.mtgActionItem.count({
        where: { ...actionBase, status: { in: ['open', 'in_progress'] }, dueDate: { lt: now } },
      }),
      prisma.mtgActionItem.count({
        where: { ...actionBase, assigneeId: userId, status: { in: ['open', 'in_progress'] } },
      }),
      prisma.mtgParticipant.count({
        where: {
          userId, response: 'pending',
          meeting: { companyId, status: 'scheduled', startsAt: { gte: now } },
        },
      }),
      prisma.mtgMeeting.findMany({
        where: { ...base, startsAt: { gte: now }, status: 'scheduled' },
        orderBy: { startsAt: 'asc' },
        take: 5,
        include: {
          organizer: { select: USER_SELECT },
          _count: { select: { participants: true, agendaItems: true } },
        },
      }),
    ]);

    const byStatus = groupCountMap(statusGroups, 'status');
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

    res.json({
      success: true,
      data: {
        meetings: {
          total,
          today,
          upcoming,
          next7Days,
          inProgress: byStatus.in_progress || 0,
          completed: byStatus.completed || 0,
          completedThisMonth,
          cancelled: byStatus.cancelled || 0,
          byStatus,
        },
        actionItems: { open: openActions, overdue: overdueActions, myOpen: myOpenActions },
        invitations: { myPending: myPendingInvites },
        nextMeetings,
      },
      message: 'Meeting dashboard loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load meeting dashboard');
  }
};

// ─── Meetings CRUD ───────────────────────────────────────────────────────────

const getMeetings = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { search, status, meetingType, organizerId, from, to, sortDir = 'desc' } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const where = { companyId, ...meetingScopeWhere(req) };
    if (clean(status)) where.status = clean(status);
    if (clean(meetingType)) where.meetingType = clean(meetingType);
    if (clean(organizerId)) where.organizerId = clean(organizerId);
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
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { location: { contains: q, mode: 'insensitive' } },
      ];
      where.AND = [{ OR: searchOr }];
    }

    const [meetings, total] = await Promise.all([
      prisma.mtgMeeting.findMany({
        where,
        orderBy: { startsAt: sortDir === 'asc' ? 'asc' : 'desc' },
        skip,
        take: limit,
        include: {
          organizer: { select: USER_SELECT },
          _count: { select: { participants: true, actionItems: true, agendaItems: true } },
        },
      }),
      prisma.mtgMeeting.count({ where }),
    ]);

    res.json({
      success: true,
      data: meetings,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      message: 'Meetings loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load meetings');
  }
};

const getMeetingById = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const meeting = await findMeetingOrThrow(req, companyId, req.params.id, {
      include: {
        organizer: { select: USER_SELECT },
        creator: { select: USER_SELECT },
        participants: { include: { user: { select: USER_SELECT } }, orderBy: { createdAt: 'asc' } },
        agendaItems: { orderBy: { sortOrder: 'asc' }, include: { presenter: { select: USER_SELECT } } },
        minutes: { orderBy: { recordedAt: 'desc' } },
        actionItems: { orderBy: { createdAt: 'asc' }, include: { assignee: { select: USER_SELECT } } },
        attachments: true,
      },
    });
    res.json({ success: true, data: meeting, message: 'Meeting loaded' });
  } catch (err) {
    sendError(res, err, 'Failed to load meeting');
  }
};

const createMeeting = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const b = req.body || {};

    const title = clean(b.title);
    if (!title) throw httpError(400, 'Meeting title is required');

    const schedule = resolveSchedule({
      startsAt: parseDate(b.startsAt, 'start time'),
      endsAt: parseDate(b.endsAt, 'end time'),
      durationMinutes: b.durationMinutes,
    });

    const organizerId = clean(b.organizerId) || userId;
    await assertUserInCompany(organizerId, companyId, 'Organizer');
    const participants = await buildParticipants(b, companyId, organizerId);

    const agendaItems = Array.isArray(b.agendaItems)
      ? b.agendaItems.filter((a) => clean(a?.title)).map((a, i) => ({
        title: clean(a.title),
        presenterId: clean(a.presenterId),
        allocatedMinutes: Number.isFinite(parseInt(a.allocatedMinutes, 10)) ? parseInt(a.allocatedMinutes, 10) : null,
        sortOrder: Number.isFinite(parseInt(a.sortOrder, 10)) ? parseInt(a.sortOrder, 10) : i,
        notes: clean(a.notes),
      }))
      : [];
    for (const a of agendaItems) await assertUserInCompany(a.presenterId, companyId, 'Presenter');

    const meeting = await prisma.mtgMeeting.create({
      data: {
        companyId,
        title,
        description: clean(b.description),
        meetingType: pickEnum(b.meetingType, MEETING_TYPES, 'meeting type') || 'internal',
        ...schedule,
        location: clean(b.location),
        meetingLink: clean(b.meetingLink),
        organizerId,
        status: pickEnum(b.status, MEETING_STATUSES, 'status') || 'scheduled',
        agendaSummary: clean(b.agendaSummary),
        createdBy: userId,
        participants: { create: participants },
        ...(agendaItems.length ? { agendaItems: { create: agendaItems } } : {}),
      },
      include: {
        organizer: { select: USER_SELECT },
        participants: true,
        agendaItems: true,
      },
    });

    await logActivity({
      meetingId: meeting.id, userId, action: 'meeting_created',
      message: `Meeting "${meeting.title}" scheduled`,
    });

    try {
      const { sendToUser } = require('../services/notificationService');
      const inviteeIds = participants
        .map((p) => p.userId)
        .filter((id) => id && id !== userId);
      await Promise.all(
        [...new Set(inviteeIds)].map((uid) =>
          sendToUser({
            mongoUserId: uid,
            title: 'Meeting invitation',
            message: `"${meeting.title}" on ${meeting.startsAt.toISOString()}`,
            category: 'Meetings',
            type: 'info',
            data: { meetingId: meeting.id, href: `/meetings/${meeting.id}` },
          }).catch(() => null)
        )
      );
    } catch (notifyErr) {
      console.warn('[Meetings] notify failed:', notifyErr.message);
    }

    res.status(201).json({ success: true, data: meeting, message: 'Meeting created' });
  } catch (err) {
    sendError(res, err, 'Failed to create meeting');
  }
};

const updateMeeting = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const b = req.body || {};
    const existing = await findMeetingOrThrow(req, companyId, req.params.id);

    const data = {};
    if (b.title !== undefined) {
      const title = clean(b.title);
      if (!title) throw httpError(400, 'Meeting title cannot be empty');
      data.title = title;
    }
    if (b.description !== undefined) data.description = clean(b.description);
    if (b.meetingType !== undefined) data.meetingType = pickEnum(b.meetingType, MEETING_TYPES, 'meeting type');
    if (b.location !== undefined) data.location = clean(b.location);
    if (b.meetingLink !== undefined) data.meetingLink = clean(b.meetingLink);
    if (b.agendaSummary !== undefined) data.agendaSummary = clean(b.agendaSummary);
    if (b.minutesSummary !== undefined) data.minutesSummary = clean(b.minutesSummary);
    if (b.status !== undefined) data.status = pickEnum(b.status, MEETING_STATUSES, 'status');
    if (b.organizerId !== undefined) {
      const organizerId = clean(b.organizerId);
      if (!organizerId) throw httpError(400, 'Organizer cannot be empty');
      await assertUserInCompany(organizerId, companyId, 'Organizer');
      data.organizerId = organizerId;
    }

    if (b.startsAt !== undefined || b.endsAt !== undefined || b.durationMinutes !== undefined) {
      const startsAt = b.startsAt !== undefined ? parseDate(b.startsAt, 'start time') : existing.startsAt;
      let endsAt;
      if (b.endsAt !== undefined) endsAt = parseDate(b.endsAt, 'end time');
      else if (b.durationMinutes === undefined) endsAt = new Date(startsAt.getTime() + existing.durationMinutes * 60000);
      Object.assign(data, resolveSchedule(
        { startsAt, endsAt, durationMinutes: b.durationMinutes },
        existing.durationMinutes,
      ));
    }

    const meeting = await prisma.mtgMeeting.update({
      where: { id: existing.id },
      data,
      include: { organizer: { select: USER_SELECT } },
    });

    const statusChanged = data.status && data.status !== existing.status;
    await logActivity({
      meetingId: existing.id, userId,
      action: statusChanged ? `meeting_${data.status}` : 'meeting_updated',
      message: statusChanged
        ? `Meeting status changed from ${existing.status} to ${data.status}`
        : `Meeting "${meeting.title}" updated`,
    });

    res.json({ success: true, data: meeting, message: 'Meeting updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update meeting');
  }
};

const deleteMeeting = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing = await findMeetingOrThrow(req, companyId, req.params.id, { select: { id: true } });
    // Children (participants, agenda, minutes, actions, attachments, activity) cascade.
    await prisma.mtgMeeting.delete({ where: { id: existing.id } });
    res.json({ success: true, data: { id: existing.id }, message: 'Meeting deleted' });
  } catch (err) {
    sendError(res, err, 'Failed to delete meeting');
  }
};

// ─── Participants ────────────────────────────────────────────────────────────

const getParticipants = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const meeting = await findMeetingOrThrow(req, companyId, req.params.id, { select: { id: true } });
    const participants = await prisma.mtgParticipant.findMany({
      where: { meetingId: meeting.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: USER_SELECT } },
    });
    res.json({ success: true, data: participants, message: 'Participants loaded' });
  } catch (err) {
    sendError(res, err, 'Failed to load participants');
  }
};

const addParticipants = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const meeting = await findMeetingOrThrow(req, companyId, req.params.id, { select: { id: true, organizerId: true } });

    const candidates = await buildParticipants(req.body || {}, companyId, null);
    if (!candidates.length) throw httpError(400, 'Provide participantIds and/or guests');

    const existing = await prisma.mtgParticipant.findMany({
      where: { meetingId: meeting.id },
      select: { userId: true, guestEmail: true },
    });
    const haveUsers = new Set(existing.filter((p) => p.userId).map((p) => p.userId));
    const haveEmails = new Set(existing.filter((p) => p.guestEmail).map((p) => p.guestEmail.toLowerCase()));

    const toCreate = candidates.filter((c) => (c.userId
      ? !haveUsers.has(c.userId)
      : !(c.guestEmail && haveEmails.has(c.guestEmail.toLowerCase()))));
    if (toCreate.length) {
      await prisma.mtgParticipant.createMany({
        data: toCreate.map((c) => ({ ...c, meetingId: meeting.id })),
      });
      await logActivity({
        meetingId: meeting.id, userId, action: 'participants_added',
        message: `${toCreate.length} participant(s) added`,
      });
    }

    const participants = await prisma.mtgParticipant.findMany({
      where: { meetingId: meeting.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: USER_SELECT } },
    });
    res.status(201).json({ success: true, data: participants, message: `${toCreate.length} participant(s) added` });
  } catch (err) {
    sendError(res, err, 'Failed to add participants');
  }
};

/** Participant updates their own RSVP (or an editor updates response/attended). */
const updateParticipant = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const b = req.body || {};
    const participant = await prisma.mtgParticipant.findFirst({
      where: { id: req.params.participantId, meetingId: req.params.id, meeting: { companyId } },
    });
    if (!participant) throw httpError(404, 'Participant not found');

    const data = {};
    if (b.response !== undefined) data.response = pickEnum(b.response, RESPONSES, 'response');
    if (b.attended !== undefined) data.attended = b.attended === null ? null : Boolean(b.attended);

    const updated = await prisma.mtgParticipant.update({ where: { id: participant.id }, data });
    res.json({ success: true, data: updated, message: 'Participant updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update participant');
  }
};

// ─── Agenda (meetings.agenda.*) ──────────────────────────────────────────────

const AGENDA_INCLUDE = { presenter: { select: USER_SELECT } };

function parseOptionalMinutes(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) throw httpError(400, 'allocatedMinutes must be a non-negative number');
  return n;
}

const getAgenda = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const meeting = await findMeetingOrThrow(req, companyId, req.params.id, {
      select: { id: true, durationMinutes: true, agendaSummary: true },
    });
    const items = await prisma.mtgAgendaItem.findMany({
      where: { meetingId: meeting.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: AGENDA_INCLUDE,
    });
    const allocated = items.reduce((s, i) => s + (i.allocatedMinutes || 0), 0);
    res.json({
      success: true,
      data: items,
      summary: {
        count: items.length,
        allocatedMinutes: allocated,
        meetingDurationMinutes: meeting.durationMinutes,
        agendaSummary: meeting.agendaSummary,
      },
      message: 'Agenda loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load agenda');
  }
};

const createAgendaItem = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const b = req.body || {};
    const meeting = await findMeetingOrThrow(req, companyId, req.params.id, { select: { id: true } });

    const title = clean(b.title);
    if (!title) throw httpError(400, 'Agenda item title is required');
    const presenterId = clean(b.presenterId);
    await assertUserInCompany(presenterId, companyId, 'Presenter');

    let sortOrder = parseInt(b.sortOrder, 10);
    if (!Number.isFinite(sortOrder)) {
      const agg = await prisma.mtgAgendaItem.aggregate({ where: { meetingId: meeting.id }, _max: { sortOrder: true } });
      sortOrder = (agg._max.sortOrder ?? -1) + 1;
    }

    const item = await prisma.mtgAgendaItem.create({
      data: {
        meetingId: meeting.id,
        title,
        presenterId,
        allocatedMinutes: parseOptionalMinutes(b.allocatedMinutes) ?? null,
        sortOrder,
        notes: clean(b.notes),
      },
      include: AGENDA_INCLUDE,
    });
    await logActivity({
      meetingId: meeting.id, userId, action: 'agenda_item_added', message: `Agenda item "${title}" added`,
    });

    res.status(201).json({ success: true, data: item, message: 'Agenda item added' });
  } catch (err) {
    sendError(res, err, 'Failed to add agenda item');
  }
};

async function findAgendaItemOrThrow(req, companyId, itemId) {
  const item = await prisma.mtgAgendaItem.findFirst({
    where: { id: itemId, meeting: { companyId, ...meetingScopeWhere(req) } },
  });
  if (!item) throw httpError(404, 'Agenda item not found');
  return item;
}

const updateAgendaItem = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const b = req.body || {};
    const existing = await findAgendaItemOrThrow(req, companyId, req.params.itemId);

    const data = {};
    if (b.title !== undefined) {
      const title = clean(b.title);
      if (!title) throw httpError(400, 'Agenda item title cannot be empty');
      data.title = title;
    }
    if (b.presenterId !== undefined) {
      const presenterId = clean(b.presenterId);
      await assertUserInCompany(presenterId, companyId, 'Presenter');
      data.presenterId = presenterId;
    }
    if (b.allocatedMinutes !== undefined) data.allocatedMinutes = parseOptionalMinutes(b.allocatedMinutes);
    if (b.sortOrder !== undefined) data.sortOrder = parseInt(b.sortOrder, 10) || 0;
    if (b.notes !== undefined) data.notes = clean(b.notes);

    const item = await prisma.mtgAgendaItem.update({ where: { id: existing.id }, data, include: AGENDA_INCLUDE });
    res.json({ success: true, data: item, message: 'Agenda item updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update agenda item');
  }
};

const deleteAgendaItem = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing = await findAgendaItemOrThrow(req, companyId, req.params.itemId);
    await prisma.mtgAgendaItem.delete({ where: { id: existing.id } });
    res.json({ success: true, data: { id: existing.id }, message: 'Agenda item deleted' });
  } catch (err) {
    sendError(res, err, 'Failed to delete agenda item');
  }
};

// ─── Minutes (meetings.minutes.*) ────────────────────────────────────────────

const MINUTE_INCLUDE = { recorder: { select: USER_SELECT } };

/** Returns the current (latest) minute record plus history of revisions, if any. */
const getMinutes = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const meeting = await findMeetingOrThrow(req, companyId, req.params.id, {
      select: { id: true, title: true, minutesSummary: true, status: true },
    });
    const history = await prisma.mtgMinute.findMany({
      where: { meetingId: meeting.id },
      orderBy: { recordedAt: 'desc' },
      include: MINUTE_INCLUDE,
    });
    res.json({
      success: true,
      data: {
        meetingId: meeting.id,
        minutesSummary: meeting.minutesSummary,
        minute: history[0] || null,
        history,
      },
      message: 'Minutes loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load minutes');
  }
};

/**
 * Upsert the minutes: updates the latest MtgMinute (or creates the first one) and
 * refreshes meeting.minutesSummary (body.summary, else the first 500 chars of content).
 */
const upsertMinutes = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const b = req.body || {};
    const meeting = await findMeetingOrThrow(req, companyId, req.params.id, { select: { id: true, status: true } });

    const content = clean(b.content);
    if (!content) throw httpError(400, 'Minutes content is required');
    const decisions = b.decisions === undefined ? undefined : clean(b.decisions);
    const summary = clean(b.summary ?? b.minutesSummary)
      || (content.length > 500 ? `${content.slice(0, 497)}...` : content);

    const latest = await prisma.mtgMinute.findFirst({
      where: { meetingId: meeting.id },
      orderBy: { recordedAt: 'desc' },
      select: { id: true },
    });

    const minute = await prisma.$transaction(async (tx) => {
      const m = latest
        ? await tx.mtgMinute.update({
          where: { id: latest.id },
          data: { content, ...(decisions !== undefined ? { decisions } : {}), recordedBy: userId },
          include: MINUTE_INCLUDE,
        })
        : await tx.mtgMinute.create({
          data: { meetingId: meeting.id, content, decisions: decisions ?? null, recordedBy: userId },
          include: MINUTE_INCLUDE,
        });
      await tx.mtgMeeting.update({ where: { id: meeting.id }, data: { minutesSummary: summary } });
      return m;
    });

    await logActivity({
      meetingId: meeting.id, userId,
      action: latest ? 'minutes_updated' : 'minutes_recorded',
      message: latest ? 'Meeting minutes updated' : 'Meeting minutes recorded',
    });

    res.status(latest ? 200 : 201).json({
      success: true,
      data: { meetingId: meeting.id, minutesSummary: summary, minute },
      message: latest ? 'Minutes updated' : 'Minutes recorded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to save minutes');
  }
};

// ─── Action items (meetings.action_items.*) ──────────────────────────────────

const ACTION_STATUSES = ['open', 'in_progress', 'done', 'cancelled'];
const ACTION_INCLUDE = {
  assignee: { select: USER_SELECT },
  linkedTask: { select: { id: true, title: true, status: true, projectId: true } },
};

async function assertTaskInCompany(taskId, companyId) {
  if (!taskId) return;
  const t = await prisma.pmTask.findFirst({ where: { id: taskId, project: { companyId } }, select: { id: true } });
  if (!t) throw httpError(400, 'Linked task does not belong to the active company');
}

const getActionItems = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const meeting = await findMeetingOrThrow(req, companyId, req.params.id, { select: { id: true } });
    const where = { meetingId: meeting.id };
    if (clean(req.query.status)) where.status = clean(req.query.status);
    if (clean(req.query.assigneeId)) where.assigneeId = clean(req.query.assigneeId);
    const items = await prisma.mtgActionItem.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      include: ACTION_INCLUDE,
    });
    const now = new Date();
    res.json({
      success: true,
      data: items.map((i) => ({
        ...i,
        isOverdue: !!i.dueDate && i.dueDate < now && ['open', 'in_progress'].includes(i.status),
      })),
      message: 'Action items loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load action items');
  }
};

const createActionItem = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const b = req.body || {};
    const meeting = await findMeetingOrThrow(req, companyId, req.params.id, { select: { id: true } });

    const title = clean(b.title);
    if (!title) throw httpError(400, 'Action item title is required');
    const assigneeId = clean(b.assigneeId);
    await assertUserInCompany(assigneeId, companyId, 'Assignee');
    const linkedTaskId = clean(b.linkedTaskId);
    await assertTaskInCompany(linkedTaskId, companyId);

    const item = await prisma.mtgActionItem.create({
      data: {
        meetingId: meeting.id,
        title,
        assigneeId,
        dueDate: parseDate(b.dueDate, 'due date') || null,
        status: pickEnum(b.status, ACTION_STATUSES, 'status') || 'open',
        linkedTaskId,
      },
      include: ACTION_INCLUDE,
    });
    await logActivity({
      meetingId: meeting.id, userId, action: 'action_item_added', message: `Action item "${title}" added`,
    });

    res.status(201).json({ success: true, data: item, message: 'Action item created' });
  } catch (err) {
    sendError(res, err, 'Failed to create action item');
  }
};

async function findActionItemOrThrow(req, companyId, itemId) {
  const item = await prisma.mtgActionItem.findFirst({
    where: { id: itemId, meeting: { companyId, ...meetingScopeWhere(req) } },
  });
  if (!item) throw httpError(404, 'Action item not found');
  return item;
}

const updateActionItem = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const b = req.body || {};
    const existing = await findActionItemOrThrow(req, companyId, req.params.itemId);

    const data = {};
    if (b.title !== undefined) {
      const title = clean(b.title);
      if (!title) throw httpError(400, 'Action item title cannot be empty');
      data.title = title;
    }
    if (b.assigneeId !== undefined) {
      const assigneeId = clean(b.assigneeId);
      await assertUserInCompany(assigneeId, companyId, 'Assignee');
      data.assigneeId = assigneeId;
    }
    const dueDate = parseDate(b.dueDate, 'due date');
    if (dueDate !== undefined) data.dueDate = dueDate;
    if (b.status !== undefined) data.status = pickEnum(b.status, ACTION_STATUSES, 'status');
    if (b.linkedTaskId !== undefined) {
      const linkedTaskId = clean(b.linkedTaskId);
      await assertTaskInCompany(linkedTaskId, companyId);
      data.linkedTaskId = linkedTaskId;
    }

    const item = await prisma.mtgActionItem.update({ where: { id: existing.id }, data, include: ACTION_INCLUDE });

    if (data.status && data.status !== existing.status) {
      await logActivity({
        meetingId: existing.meetingId, userId, action: `action_item_${data.status}`,
        message: `Action item "${item.title}" marked ${data.status.replace('_', ' ')}`,
      });
    }

    res.json({ success: true, data: item, message: 'Action item updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update action item');
  }
};

const deleteActionItem = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing = await findActionItemOrThrow(req, companyId, req.params.itemId);
    await prisma.mtgActionItem.delete({ where: { id: existing.id } });
    res.json({ success: true, data: { id: existing.id }, message: 'Action item deleted' });
  } catch (err) {
    sendError(res, err, 'Failed to delete action item');
  }
};

// ─── Complete meeting ────────────────────────────────────────────────────────

const completeMeeting = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const existing = await findMeetingOrThrow(req, companyId, req.params.id);
    if (existing.status === 'completed') throw httpError(400, 'Meeting is already completed');
    if (existing.status === 'cancelled') throw httpError(400, 'A cancelled meeting cannot be completed');

    const data = { status: 'completed' };
    if (req.body?.minutesSummary !== undefined) data.minutesSummary = clean(req.body.minutesSummary);
    const meeting = await prisma.mtgMeeting.update({
      where: { id: existing.id },
      data,
      include: { organizer: { select: USER_SELECT } },
    });
    await logActivity({
      meetingId: existing.id, userId, action: 'meeting_completed',
      message: `Meeting "${meeting.title}" marked as completed`,
    });

    res.json({ success: true, data: meeting, message: 'Meeting completed' });
  } catch (err) {
    sendError(res, err, 'Failed to complete meeting');
  }
};

// ─── Reports (meetings.reports.view) ─────────────────────────────────────────

const getReportsSummary = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const now = new Date();
    const scopeWhere = meetingScopeWhere(req);
    const fromD = parseDate(clean(req.query.from) || undefined, 'from date');
    const toD = parseDate(clean(req.query.to) || undefined, 'to date');

    const meetingWhere = { companyId, ...scopeWhere };
    if (fromD || toD) {
      meetingWhere.startsAt = {};
      if (fromD) meetingWhere.startsAt.gte = fromD;
      if (toD) meetingWhere.startsAt.lte = toD;
    }
    const meetingRel = { meeting: meetingWhere };

    const [
      statusGroups, typeGroups, durationAgg, withMinutes, responseGroups, attendedGroups,
      actionGroups, overdueActions, actionByAssignee, organizerGroups, recentCompleted,
    ] = await Promise.all([
      prisma.mtgMeeting.groupBy({ by: ['status'], where: meetingWhere, _count: { _all: true } }),
      prisma.mtgMeeting.groupBy({ by: ['meetingType'], where: meetingWhere, _count: { _all: true } }),
      prisma.mtgMeeting.aggregate({
        where: { ...meetingWhere, status: 'completed' }, _sum: { durationMinutes: true }, _avg: { durationMinutes: true },
      }),
      prisma.mtgMeeting.count({
        where: { ...meetingWhere, status: 'completed', minutes: { some: {} } },
      }),
      prisma.mtgParticipant.groupBy({ by: ['response'], where: meetingRel, _count: { _all: true } }),
      prisma.mtgParticipant.groupBy({
        by: ['attended'], where: { meeting: { ...meetingWhere, status: 'completed' } }, _count: { _all: true },
      }),
      prisma.mtgActionItem.groupBy({ by: ['status'], where: meetingRel, _count: { _all: true } }),
      prisma.mtgActionItem.count({
        where: { ...meetingRel, status: { in: ['open', 'in_progress'] }, dueDate: { lt: now } },
      }),
      prisma.mtgActionItem.groupBy({
        by: ['assigneeId'],
        where: { ...meetingRel, assigneeId: { not: null }, status: { in: ['open', 'in_progress'] } },
        _count: { _all: true },
      }),
      prisma.mtgMeeting.groupBy({ by: ['organizerId'], where: meetingWhere, _count: { _all: true } }),
      prisma.mtgMeeting.findMany({
        where: { ...meetingWhere, status: 'completed' },
        orderBy: { startsAt: 'desc' },
        take: 10,
        select: {
          id: true, title: true, meetingType: true, startsAt: true, durationMinutes: true,
          _count: { select: { participants: true, actionItems: true } },
        },
      }),
    ]);

    const userIds = [...new Set([
      ...actionByAssignee.map((r) => r.assigneeId),
      ...organizerGroups.map((r) => r.organizerId),
    ])];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: USER_SELECT })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const byStatus = groupCountMap(statusGroups, 'status');
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const completed = byStatus.completed || 0;
    const actionsByStatus = groupCountMap(actionGroups, 'status');
    const actionsTotal = Object.values(actionsByStatus).reduce((a, b) => a + b, 0);

    let attended = 0;
    let notAttended = 0;
    for (const r of attendedGroups) {
      if (r.attended === true) attended += r._count._all;
      else if (r.attended === false) notAttended += r._count._all;
    }

    res.json({
      success: true,
      data: {
        range: { from: fromD || null, to: toD || null },
        meetings: {
          total,
          byStatus,
          byType: groupCountMap(typeGroups, 'meetingType'),
          completionRate: total ? Math.round((completed / total) * 100) : 0,
          completedWithMinutes: withMinutes,
          minutesCoverage: completed ? Math.round((withMinutes / completed) * 100) : 0,
          totalCompletedMinutes: durationAgg._sum.durationMinutes || 0,
          averageDurationMinutes: Math.round(durationAgg._avg.durationMinutes || 0),
        },
        attendance: {
          invitations: groupCountMap(responseGroups, 'response'),
          attended,
          notAttended,
          attendanceRate: attended + notAttended ? Math.round((attended / (attended + notAttended)) * 100) : 0,
        },
        actionItems: {
          total: actionsTotal,
          byStatus: actionsByStatus,
          overdue: overdueActions,
          completionRate: actionsTotal ? Math.round(((actionsByStatus.done || 0) / actionsTotal) * 100) : 0,
          openByAssignee: actionByAssignee
            .map((r) => ({ user: userMap.get(r.assigneeId) || { id: r.assigneeId }, open: r._count._all }))
            .sort((a, b) => b.open - a.open),
        },
        byOrganizer: organizerGroups
          .map((r) => ({ user: userMap.get(r.organizerId) || { id: r.organizerId }, meetings: r._count._all }))
          .sort((a, b) => b.meetings - a.meetings),
        recentCompleted,
      },
      message: 'Meeting report loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load meeting report');
  }
};

module.exports = {
  getDashboard,
  getMeetings,
  getMeetingById,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  getParticipants,
  addParticipants,
  updateParticipant,
  // Agenda
  getAgenda,
  createAgendaItem,
  updateAgendaItem,
  deleteAgendaItem,
  // Minutes
  getMinutes,
  upsertMinutes,
  // Action items
  getActionItems,
  createActionItem,
  updateActionItem,
  deleteActionItem,
  // Lifecycle & reports
  completeMeeting,
  getReportsSummary,
};
