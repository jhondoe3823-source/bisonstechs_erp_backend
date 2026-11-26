/**
 * Notice Board Controller - Bisonstechs ERP (Business Applications Suite)
 * Dashboard, notices CRUD, approve, mark read, categories.
 * All queries are scoped by companyId.
 */
const prisma = require('../prisma/client');
const {
  getCompanyId, getUserId, httpError, sendError, parsePagination, clean, parseDate,
  pickEnum, startOfDay, groupCountMap, slugify, assertUserInCompany,
} = require('../utils/businessAppsHelpers');

const NOTICE_STATUSES = ['draft', 'pending_approval', 'scheduled', 'published', 'expired', 'archived'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const AUDIENCE_TYPES = ['company', 'department', 'role', 'employee', 'branch'];

const USER_SELECT = { id: true, firstName: true, lastName: true, email: true };

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getSettings(companyId) {
  const s = await prisma.ntcSettings.findUnique({ where: { companyId } });
  return s || { requireApproval: false, notifyOnPublish: true };
}

/** Lazy lifecycle sweep: scheduled → published, published → expired. */
async function sweepLifecycle(companyId) {
  const now = new Date();
  try {
    await prisma.ntcNotice.updateMany({
      where: { companyId, status: 'scheduled', publishAt: { lte: now } },
      data: { status: 'published', publishedAt: now },
    });
    await prisma.ntcNotice.updateMany({
      where: { companyId, status: 'published', expireAt: { not: null, lte: now } },
      data: { status: 'expired' },
    });
  } catch (e) {
    console.warn('[Notices] Lifecycle sweep failed:', e.message);
  }
}

/** OWN scope → user's own notices plus anything published. */
function noticeScopeWhere(req) {
  if (req.permissionScope !== 'OWN') return {};
  return { OR: [{ createdBy: getUserId(req) }, { status: 'published' }] };
}

function parseAudiences(raw) {
  if (raw === undefined) return undefined;
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const a of list) {
    const audienceType = pickEnum(a?.audienceType ?? a?.type, AUDIENCE_TYPES, 'audience type');
    if (!audienceType) continue;
    const audienceId = clean(a?.audienceId ?? a?.id);
    if (audienceType !== 'company' && !audienceId) {
      throw httpError(400, `audienceId is required for audience type "${audienceType}"`);
    }
    out.push({ audienceType, audienceId: audienceType === 'company' ? null : audienceId });
  }
  return out.length ? out : [{ audienceType: 'company', audienceId: null }];
}

/** Work out the effective status given the request and company approval policy. */
function resolveStatus({ requested, publishAt, requireApproval, canApprove }) {
  if (requested === 'published') {
    if (requireApproval && !canApprove) return 'pending_approval';
    if (publishAt && publishAt > new Date()) return 'scheduled';
    return 'published';
  }
  if (requested === 'scheduled') {
    if (!publishAt) throw httpError(400, 'publishAt is required for scheduled notices');
    if (requireApproval && !canApprove) return 'pending_approval';
    return 'scheduled';
  }
  return requested || 'draft';
}

function canApproveNotices(req) {
  if (req.effectivePermissions?.isAdmin) return true;
  return req.effectivePermissions?.permissionMap?.['notices.notices.approve']?.granted === true;
}

async function findNoticeOrThrow(req, companyId, id, extra = {}) {
  const notice = await prisma.ntcNotice.findFirst({
    where: { id, companyId, ...noticeScopeWhere(req) },
    ...extra,
  });
  if (!notice) throw httpError(404, 'Notice not found');
  return notice;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

const getDashboard = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    await sweepLifecycle(companyId);
    const now = new Date();
    const base = { companyId, ...noticeScopeWhere(req) };
    const activePublished = {
      companyId, status: 'published',
      OR: [{ expireAt: null }, { expireAt: { gt: now } }],
    };
    const in7Days = new Date(now.getTime() + 7 * 86400000);

    const [
      statusGroups, unreadForMe, readReceiptsTotal, commentsTotal, expiringSoon,
      publishedToday, recent, urgentActive,
    ] = await Promise.all([
      prisma.ntcNotice.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      prisma.ntcNotice.count({
        where: { ...activePublished, readReceipts: { none: { userId } } },
      }),
      prisma.ntcReadReceipt.count({ where: { notice: { companyId } } }),
      prisma.ntcComment.count({ where: { notice: { companyId } } }),
      prisma.ntcNotice.count({
        where: { ...activePublished, expireAt: { gt: now, lte: in7Days } },
      }),
      prisma.ntcNotice.count({
        where: { companyId, status: 'published', publishedAt: { gte: startOfDay(now) } },
      }),
      prisma.ntcNotice.findMany({
        where: base,
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true, title: true, category: true, priority: true, status: true,
          publishAt: true, publishedAt: true, createdAt: true,
          _count: { select: { readReceipts: true, comments: true } },
        },
      }),
      prisma.ntcNotice.count({ where: { ...activePublished, priority: 'urgent' } }),
    ]);

    const byStatus = groupCountMap(statusGroups, 'status');
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

    res.json({
      success: true,
      data: {
        notices: {
          total,
          draft: byStatus.draft || 0,
          pendingApproval: byStatus.pending_approval || 0,
          scheduled: byStatus.scheduled || 0,
          published: byStatus.published || 0,
          expired: byStatus.expired || 0,
          archived: byStatus.archived || 0,
          publishedToday,
          expiringSoon,
          urgentActive,
          byStatus,
        },
        engagement: { readReceipts: readReceiptsTotal, comments: commentsTotal },
        me: { unread: unreadForMe },
        recent,
      },
      message: 'Notice board dashboard loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load notice board dashboard');
  }
};

// ─── Notices CRUD ────────────────────────────────────────────────────────────

const getNotices = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    await sweepLifecycle(companyId);
    const { search, status, category, priority, unread, sortDir = 'desc' } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const and = [];
    const where = { companyId };
    const scope = noticeScopeWhere(req);
    if (scope.OR) and.push({ OR: scope.OR });
    if (clean(status)) where.status = clean(status);
    if (clean(category)) where.category = clean(category);
    if (clean(priority)) where.priority = clean(priority);
    if (unread === '1' || unread === 'true') {
      where.status = 'published';
      where.readReceipts = { none: { userId } };
    }
    if (clean(search)) {
      const q = clean(search);
      and.push({ OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { body: { contains: q, mode: 'insensitive' } },
      ] });
    }
    if (and.length) where.AND = and;

    const [notices, total] = await Promise.all([
      prisma.ntcNotice.findMany({
        where,
        orderBy: [{ createdAt: sortDir === 'asc' ? 'asc' : 'desc' }],
        skip,
        take: limit,
        include: {
          creator: { select: USER_SELECT },
          audiences: true,
          readReceipts: { where: { userId }, select: { readAt: true } },
          _count: { select: { readReceipts: true, comments: true, attachments: true } },
        },
      }),
      prisma.ntcNotice.count({ where }),
    ]);

    const data = notices.map(({ readReceipts, ...n }) => ({
      ...n,
      isRead: readReceipts.length > 0,
      readAt: readReceipts[0]?.readAt || null,
    }));

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      message: 'Notices loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load notices');
  }
};

const getNoticeById = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const notice = await findNoticeOrThrow(req, companyId, req.params.id, {
      include: {
        creator: { select: USER_SELECT },
        approver: { select: USER_SELECT },
        audiences: true,
        attachments: true,
        readReceipts: { where: { userId }, select: { readAt: true } },
        _count: { select: { readReceipts: true, comments: true } },
      },
    });
    const { readReceipts, ...rest } = notice;
    res.json({
      success: true,
      data: { ...rest, isRead: readReceipts.length > 0, readAt: readReceipts[0]?.readAt || null },
      message: 'Notice loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load notice');
  }
};

const createNotice = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const b = req.body || {};

    const title = clean(b.title);
    const body = clean(b.body);
    if (!title) throw httpError(400, 'Notice title is required');
    if (!body) throw httpError(400, 'Notice body is required');

    const publishAt = parseDate(b.publishAt, 'publish date');
    const expireAt = parseDate(b.expireAt, 'expiry date');
    if (publishAt && expireAt && expireAt <= publishAt) throw httpError(400, 'Expiry must be after publish date');

    const settings = await getSettings(companyId);
    const status = resolveStatus({
      requested: pickEnum(b.status, NOTICE_STATUSES, 'status'),
      publishAt,
      requireApproval: settings.requireApproval,
      canApprove: canApproveNotices(req),
    });
    const audiences = parseAudiences(b.audiences) || [{ audienceType: 'company', audienceId: null }];

    const notice = await prisma.ntcNotice.create({
      data: {
        companyId,
        title,
        body,
        category: clean(b.category) || 'general',
        priority: pickEnum(b.priority, PRIORITIES, 'priority') || 'normal',
        status,
        publishAt: publishAt || null,
        expireAt: expireAt || null,
        allowComments: b.allowComments === undefined ? true : Boolean(b.allowComments),
        createdBy: userId,
        publishedAt: status === 'published' ? new Date() : null,
        approvedBy: status === 'published' && settings.requireApproval ? userId : null,
        audiences: { create: audiences },
      },
      include: { audiences: true, creator: { select: USER_SELECT } },
    });

    if (status === 'published' && settings.notifyOnPublish !== false) {
      try {
        const { sendToUser } = require('../services/notificationService');
        const users = await prisma.user.findMany({
          where: { companyId, isActive: true, id: { not: userId } },
          select: { id: true },
          take: 200,
        });
        await Promise.all(
          users.map((u) =>
            sendToUser({
              mongoUserId: u.id,
              title: 'New company notice',
              message: notice.title,
              category: 'Notices',
              type: notice.priority === 'urgent' ? 'warning' : 'info',
              data: { noticeId: notice.id, href: `/notices/${notice.id}` },
            }).catch(() => null)
          )
        );
      } catch (notifyErr) {
        console.warn('[Notices] notify failed:', notifyErr.message);
      }
    }

    res.status(201).json({ success: true, data: notice, message: 'Notice created' });
  } catch (err) {
    sendError(res, err, 'Failed to create notice');
  }
};

const updateNotice = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const b = req.body || {};
    const existing = await findNoticeOrThrow(req, companyId, req.params.id);
    if (req.permissionScope === 'OWN' && existing.createdBy !== userId) {
      throw httpError(403, 'Access denied. Your access is restricted to OWN records only.');
    }

    const data = {};
    if (b.title !== undefined) {
      const title = clean(b.title);
      if (!title) throw httpError(400, 'Notice title cannot be empty');
      data.title = title;
    }
    if (b.body !== undefined) {
      const body = clean(b.body);
      if (!body) throw httpError(400, 'Notice body cannot be empty');
      data.body = body;
    }
    if (b.category !== undefined) data.category = clean(b.category) || 'general';
    if (b.priority !== undefined) data.priority = pickEnum(b.priority, PRIORITIES, 'priority');
    if (b.allowComments !== undefined) data.allowComments = Boolean(b.allowComments);

    const publishAt = parseDate(b.publishAt, 'publish date');
    const expireAt = parseDate(b.expireAt, 'expiry date');
    if (publishAt !== undefined) data.publishAt = publishAt;
    if (expireAt !== undefined) data.expireAt = expireAt;
    const effPublish = publishAt !== undefined ? publishAt : existing.publishAt;
    const effExpire = expireAt !== undefined ? expireAt : existing.expireAt;
    if (effPublish && effExpire && effExpire <= effPublish) throw httpError(400, 'Expiry must be after publish date');

    if (b.status !== undefined) {
      const requested = pickEnum(b.status, NOTICE_STATUSES, 'status');
      const settings = await getSettings(companyId);
      const next = ['published', 'scheduled'].includes(requested)
        ? resolveStatus({
          requested, publishAt: effPublish,
          requireApproval: settings.requireApproval, canApprove: canApproveNotices(req),
        })
        : requested;
      if (next !== existing.status) {
        data.status = next;
        if (next === 'published') {
          data.publishedAt = existing.publishedAt || new Date();
          if (settings.requireApproval) data.approvedBy = userId;
        }
      }
    }

    const notice = await prisma.$transaction(async (tx) => {
      const audiences = parseAudiences(b.audiences);
      if (audiences) {
        await tx.ntcAudience.deleteMany({ where: { noticeId: existing.id } });
        await tx.ntcAudience.createMany({ data: audiences.map((a) => ({ ...a, noticeId: existing.id })) });
      }
      return tx.ntcNotice.update({
        where: { id: existing.id },
        data,
        include: { audiences: true, creator: { select: USER_SELECT } },
      });
    });

    res.json({ success: true, data: notice, message: 'Notice updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update notice');
  }
};

const deleteNotice = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const existing = await findNoticeOrThrow(req, companyId, req.params.id, {
      select: { id: true, createdBy: true },
    });
    if (req.permissionScope === 'OWN' && existing.createdBy !== userId) {
      throw httpError(403, 'Access denied. Your access is restricted to OWN records only.');
    }
    // Audiences, receipts, comments, attachments cascade.
    await prisma.ntcNotice.delete({ where: { id: existing.id } });
    res.json({ success: true, data: { id: existing.id }, message: 'Notice deleted' });
  } catch (err) {
    sendError(res, err, 'Failed to delete notice');
  }
};

/** Approve a pending notice and publish (or schedule) it. */
const approveNotice = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const existing = await findNoticeOrThrow(req, companyId, req.params.id);
    if (existing.status !== 'pending_approval') {
      throw httpError(400, 'Only notices pending approval can be approved');
    }
    const now = new Date();
    const scheduled = existing.publishAt && existing.publishAt > now;
    const notice = await prisma.ntcNotice.update({
      where: { id: existing.id },
      data: {
        status: scheduled ? 'scheduled' : 'published',
        approvedBy: userId,
        publishedAt: scheduled ? null : now,
      },
    });
    res.json({ success: true, data: notice, message: scheduled ? 'Notice approved and scheduled' : 'Notice approved and published' });
  } catch (err) {
    sendError(res, err, 'Failed to approve notice');
  }
};

// ─── Read receipts ───────────────────────────────────────────────────────────

const markRead = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const notice = await prisma.ntcNotice.findFirst({
      where: { id: req.params.id, companyId, status: 'published' },
      select: { id: true },
    });
    if (!notice) throw httpError(404, 'Notice not found or not published');

    const receipt = await prisma.ntcReadReceipt.upsert({
      where: { noticeId_userId: { noticeId: notice.id, userId } },
      create: { noticeId: notice.id, userId },
      update: {},
    });
    res.json({ success: true, data: receipt, message: 'Notice marked as read' });
  } catch (err) {
    sendError(res, err, 'Failed to mark notice as read');
  }
};

// ─── Categories ──────────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES = ['General', 'HR', 'IT', 'Finance', 'Operations', 'Events', 'Safety'];

const getCategories = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    let categories = await prisma.ntcCategory.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    if (!categories.length) {
      await prisma.ntcCategory.createMany({
        data: DEFAULT_CATEGORIES.map((name, i) => ({
          companyId, name, slug: slugify(name), isSystem: true, sortOrder: i,
        })),
        skipDuplicates: true,
      });
      categories = await prisma.ntcCategory.findMany({
        where: { companyId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
    }
    res.json({ success: true, data: categories, message: 'Categories loaded' });
  } catch (err) {
    sendError(res, err, 'Failed to load categories');
  }
};

const createCategory = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const name = clean(req.body?.name);
    if (!name) throw httpError(400, 'Category name is required');
    const slug = slugify(req.body?.slug || name);
    if (!slug) throw httpError(400, 'Invalid category name');
    const dup = await prisma.ntcCategory.findUnique({ where: { companyId_slug: { companyId, slug } } });
    if (dup) throw httpError(409, 'Category already exists');
    const agg = await prisma.ntcCategory.aggregate({ where: { companyId }, _max: { sortOrder: true } });
    const category = await prisma.ntcCategory.create({
      data: { companyId, name, slug, isSystem: false, sortOrder: (agg._max.sortOrder ?? -1) + 1 },
    });
    res.status(201).json({ success: true, data: category, message: 'Category created' });
  } catch (err) {
    sendError(res, err, 'Failed to create category');
  }
};

// ─── Settings (notices.settings.*) ───────────────────────────────────────────

const getNoticeSettings = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const s = await prisma.ntcSettings.findUnique({ where: { companyId } });
    res.json({
      success: true,
      data: s || { companyId, requireApproval: false, notifyOnPublish: true },
      message: 'Notice board settings loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load notice board settings');
  }
};

const updateNoticeSettings = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const b = req.body || {};
    const data = {};
    if (b.requireApproval !== undefined) data.requireApproval = Boolean(b.requireApproval);
    if (b.notifyOnPublish !== undefined) data.notifyOnPublish = Boolean(b.notifyOnPublish);
    const settings = await prisma.ntcSettings.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
    res.json({ success: true, data: settings, message: 'Notice board settings updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update notice board settings');
  }
};

// ─── Comments (notices.comments.*) ───────────────────────────────────────────

const getComments = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const notice = await findNoticeOrThrow(req, companyId, req.params.id, {
      select: { id: true, allowComments: true },
    });
    const { page, limit, skip } = parsePagination(req.query, { limit: 50 });
    const where = { noticeId: notice.id };
    const [comments, total] = await Promise.all([
      prisma.ntcComment.findMany({
        where, orderBy: { createdAt: 'asc' }, skip, take: limit,
        include: { user: { select: USER_SELECT } },
      }),
      prisma.ntcComment.count({ where }),
    ]);
    res.json({
      success: true,
      data: comments,
      meta: { allowComments: notice.allowComments },
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      message: 'Comments loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load comments');
  }
};

const createComment = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const notice = await findNoticeOrThrow(req, companyId, req.params.id, {
      select: { id: true, status: true, allowComments: true },
    });
    if (!notice.allowComments) throw httpError(403, 'Comments are disabled for this notice');
    if (notice.status !== 'published') throw httpError(400, 'Comments can only be added to published notices');

    const body = clean(req.body?.body ?? req.body?.comment ?? req.body?.message);
    if (!body) throw httpError(400, 'Comment body is required');
    if (body.length > 5000) throw httpError(400, 'Comment is too long (max 5000 characters)');

    const comment = await prisma.ntcComment.create({
      data: { noticeId: notice.id, userId, body },
      include: { user: { select: USER_SELECT } },
    });
    res.status(201).json({ success: true, data: comment, message: 'Comment added' });
  } catch (err) {
    sendError(res, err, 'Failed to add comment');
  }
};

const deleteComment = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const comment = await prisma.ntcComment.findFirst({
      where: { id: req.params.commentId, notice: { companyId } },
    });
    if (!comment) throw httpError(404, 'Comment not found');
    if (req.permissionScope === 'OWN' && comment.userId !== userId) {
      throw httpError(403, 'Access denied. Your access is restricted to OWN records only.');
    }
    await prisma.ntcComment.delete({ where: { id: comment.id } });
    res.json({ success: true, data: { id: comment.id }, message: 'Comment deleted' });
  } catch (err) {
    sendError(res, err, 'Failed to delete comment');
  }
};

// ─── Read receipts (notices.reports.view) ────────────────────────────────────

async function countCompanyUsers(companyId) {
  let n = 0;
  try {
    n = await prisma.companyMembership.count({ where: { companyId, isActive: true } });
  } catch (_) { /* membership table may be absent */ }
  if (!n) n = await prisma.user.count({ where: { companyId, isActive: true } });
  return n;
}

const getReads = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const notice = await findNoticeOrThrow(req, companyId, req.params.id, {
      select: { id: true, title: true, status: true },
    });
    const { page, limit, skip } = parsePagination(req.query, { limit: 50 });
    const where = { noticeId: notice.id };
    const [reads, total, recipients] = await Promise.all([
      prisma.ntcReadReceipt.findMany({
        where, orderBy: { readAt: 'desc' }, skip, take: limit,
        include: { user: { select: USER_SELECT } },
      }),
      prisma.ntcReadReceipt.count({ where }),
      countCompanyUsers(companyId),
    ]);
    res.json({
      success: true,
      data: reads,
      summary: {
        noticeId: notice.id,
        totalReads: total,
        companyUsers: recipients,
        readRate: recipients ? Math.min(100, Math.round((total / recipients) * 100)) : 0,
      },
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      message: 'Read receipts loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load read receipts');
  }
};

// ─── Audience (notices.audience.edit) ────────────────────────────────────────

const updateAudience = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const existing = await findNoticeOrThrow(req, companyId, req.params.id, { select: { id: true, createdBy: true } });
    if (req.permissionScope === 'OWN' && existing.createdBy !== userId) {
      throw httpError(403, 'Access denied. Your access is restricted to OWN records only.');
    }

    const raw = req.body?.audiences ?? req.body?.audience;
    if (!Array.isArray(raw)) throw httpError(400, 'audiences must be an array');
    const audiences = parseAudiences(raw); // falls back to [{ company }] when empty

    // Employee audiences must be users of the active company.
    for (const a of audiences.filter((x) => x.audienceType === 'employee')) {
      await assertUserInCompany(a.audienceId, companyId, 'Employee audience');
    }

    // de-duplicate
    const seen = new Set();
    const rows = audiences.filter((a) => {
      const k = `${a.audienceType}:${a.audienceId || ''}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const result = await prisma.$transaction(async (tx) => {
      await tx.ntcAudience.deleteMany({ where: { noticeId: existing.id } });
      await tx.ntcAudience.createMany({ data: rows.map((a) => ({ ...a, noticeId: existing.id })) });
      return tx.ntcAudience.findMany({ where: { noticeId: existing.id }, orderBy: { createdAt: 'asc' } });
    });

    res.json({ success: true, data: result, message: 'Notice audience updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update notice audience');
  }
};

// ─── Reports (notices.reports.view) ──────────────────────────────────────────

const getReportsSummary = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    await sweepLifecycle(companyId);
    const now = new Date();
    const fromD = parseDate(clean(req.query.from) || undefined, 'from date');
    const toD = parseDate(clean(req.query.to) || undefined, 'to date');

    const where = { companyId, ...noticeScopeWhere(req) };
    if (fromD || toD) {
      where.createdAt = {};
      if (fromD) where.createdAt.gte = fromD;
      if (toD) where.createdAt.lte = toD;
    }
    const rel = { notice: where };

    const [
      statusGroups, categoryGroups, priorityGroups, readsTotal, commentsTotal,
      companyUsers, topRead, topCommented, activeCount, topReaders,
    ] = await Promise.all([
      prisma.ntcNotice.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.ntcNotice.groupBy({ by: ['category'], where, _count: { _all: true } }),
      prisma.ntcNotice.groupBy({ by: ['priority'], where, _count: { _all: true } }),
      prisma.ntcReadReceipt.count({ where: rel }),
      prisma.ntcComment.count({ where: rel }),
      countCompanyUsers(companyId),
      prisma.ntcNotice.findMany({
        where: { ...where, status: 'published' },
        orderBy: { readReceipts: { _count: 'desc' } },
        take: 10,
        select: {
          id: true, title: true, category: true, priority: true, publishedAt: true,
          _count: { select: { readReceipts: true, comments: true } },
        },
      }),
      prisma.ntcNotice.findMany({
        where: { ...where, status: 'published' },
        orderBy: { comments: { _count: 'desc' } },
        take: 5,
        select: { id: true, title: true, _count: { select: { comments: true } } },
      }),
      prisma.ntcNotice.count({
        where: { ...where, status: 'published', AND: [{ OR: [{ expireAt: null }, { expireAt: { gt: now } }] }] },
      }),
      prisma.ntcReadReceipt.groupBy({
        by: ['userId'], where: rel, _count: { _all: true }, orderBy: { _count: { userId: 'desc' } }, take: 5,
      }),
    ]);

    const readerIds = topReaders.map((r) => r.userId);
    const readers = readerIds.length
      ? await prisma.user.findMany({ where: { id: { in: readerIds } }, select: USER_SELECT })
      : [];
    const readerMap = new Map(readers.map((u) => [u.id, u]));

    const byStatus = groupCountMap(statusGroups, 'status');
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const published = byStatus.published || 0;
    const expectedReads = published * companyUsers;

    res.json({
      success: true,
      data: {
        range: { from: fromD || null, to: toD || null },
        notices: {
          total,
          byStatus,
          byCategory: groupCountMap(categoryGroups, 'category'),
          byPriority: groupCountMap(priorityGroups, 'priority'),
          activePublished: activeCount,
        },
        engagement: {
          readReceipts: readsTotal,
          comments: commentsTotal,
          companyUsers,
          averageReadsPerNotice: published ? Math.round((readsTotal / published) * 10) / 10 : 0,
          overallReadRate: expectedReads ? Math.min(100, Math.round((readsTotal / expectedReads) * 100)) : 0,
        },
        topRead: topRead.map((n) => ({
          ...n,
          readRate: companyUsers ? Math.min(100, Math.round((n._count.readReceipts / companyUsers) * 100)) : 0,
        })),
        topCommented,
        topReaders: topReaders.map((r) => ({
          user: readerMap.get(r.userId) || { id: r.userId }, reads: r._count._all,
        })),
      },
      message: 'Notice board report loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load notice board report');
  }
};

module.exports = {
  getDashboard,
  getNotices,
  getNoticeById,
  createNotice,
  updateNotice,
  deleteNotice,
  approveNotice,
  markRead,
  getCategories,
  createCategory,
  // Settings
  getNoticeSettings,
  updateNoticeSettings,
  // Comments
  getComments,
  createComment,
  deleteComment,
  // Reads / audience / reports
  getReads,
  updateAudience,
  getReportsSummary,
};
