/**
 * Project Management Controller - Bisonstechs ERP (Business Applications Suite)
 * Dashboard, projects CRUD (soft-archive), tasks.
 * All queries are scoped by companyId.
 */
const prisma = require('../prisma/client');
const {
  getCompanyId, getUserId, httpError, sendError, parsePagination, clean, parseDate,
  clampPercent, parseDecimal, pickEnum, assertUserInCompany, startOfDay, groupCountMap,
} = require('../utils/businessAppsHelpers');

const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done', 'blocked', 'cancelled'];
const CLOSED_TASK_STATUSES = ['done', 'cancelled'];
const USER_SELECT = { id: true, firstName: true, lastName: true, email: true };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** OWN / TEAM scope → only projects the user manages, created, or is a member of. */
function projectScopeWhere(req) {
  const scope = req.permissionScope;
  if (scope !== 'OWN' && scope !== 'TEAM') return {};
  const uid = getUserId(req);
  return {
    OR: [
      { managerId: uid },
      { createdBy: uid },
      { members: { some: { userId: uid } } },
    ],
  };
}

async function generateProjectCode(companyId) {
  const year = new Date().getFullYear();
  const prefix = `PRJ-${year}-`;
  const last = await prisma.pmProject.findFirst({
    where: { companyId, projectCode: { startsWith: prefix } },
    orderBy: { projectCode: 'desc' },
    select: { projectCode: true },
  });
  let num = 1;
  if (last?.projectCode) {
    const n = parseInt(last.projectCode.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > 0) num = n + 1;
  }
  return `${prefix}${String(num).padStart(5, '0')}`;
}

async function logActivity({ projectId, taskId, userId, action, message, meta }) {
  try {
    await prisma.pmProjectActivity.create({
      data: { projectId, taskId: taskId || null, userId, action, message, meta: meta || undefined },
    });
  } catch (e) {
    console.warn('[Projects] Activity log failed:', e.message);
  }
}

async function findProjectOrThrow(req, companyId, id, extra = {}) {
  const project = await prisma.pmProject.findFirst({
    where: { id, companyId, ...projectScopeWhere(req) },
    ...extra,
  });
  if (!project) throw httpError(404, 'Project not found');
  return project;
}

async function assertCustomerInCompany(customerId, companyId) {
  if (!customerId) return;
  const c = await prisma.customer.findFirst({ where: { id: customerId, companyId }, select: { id: true } });
  if (!c) throw httpError(400, 'Customer does not belong to the active company');
}

/** Recalculate project progress from non-cancelled top-level + sub tasks (average). */
async function recalcProjectProgress(projectId) {
  const tasks = await prisma.pmTask.findMany({
    where: { projectId, status: { not: 'cancelled' } },
    select: { progressPercent: true, status: true },
  });
  if (!tasks.length) return;
  const total = tasks.reduce((s, t) => s + (t.status === 'done' ? 100 : t.progressPercent || 0), 0);
  await prisma.pmProject.update({
    where: { id: projectId },
    data: { progressPercent: Math.round(total / tasks.length) },
  });
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

const getDashboard = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const now = new Date();
    const scopeWhere = projectScopeWhere(req);
    const projectWhere = { companyId, isArchived: false, ...scopeWhere };
    const taskProjectWhere = { project: { companyId, isArchived: false, ...scopeWhere } };
    const weekStart = startOfDay(new Date(now.getTime() - 6 * 86400000));
    const in7Days = new Date(now.getTime() + 7 * 86400000);

    const [
      statusGroups, archivedCount, taskGroups, overdueTasks, myOpenTasks,
      upcomingMilestones, overdueMilestones, timeAgg, runningTimers, recentActivity,
      overdueProjects, budgetAgg,
    ] = await Promise.all([
      prisma.pmProject.groupBy({ by: ['status'], where: projectWhere, _count: { _all: true } }),
      prisma.pmProject.count({ where: { companyId, isArchived: true, ...scopeWhere } }),
      prisma.pmTask.groupBy({ by: ['status'], where: taskProjectWhere, _count: { _all: true } }),
      prisma.pmTask.count({
        where: { ...taskProjectWhere, dueDate: { lt: now }, status: { notIn: CLOSED_TASK_STATUSES } },
      }),
      prisma.pmTask.count({
        where: { ...taskProjectWhere, assigneeId: userId, status: { notIn: CLOSED_TASK_STATUSES } },
      }),
      prisma.pmMilestone.count({
        where: {
          project: { companyId, isArchived: false, ...scopeWhere },
          status: { in: ['pending', 'in_progress'] },
          targetDate: { gte: now, lte: in7Days },
        },
      }),
      prisma.pmMilestone.count({
        where: {
          project: { companyId, isArchived: false, ...scopeWhere },
          status: { in: ['pending', 'in_progress'] },
          targetDate: { lt: now },
        },
      }),
      prisma.pmTimeEntry.aggregate({
        where: { project: { companyId, ...scopeWhere }, startedAt: { gte: weekStart } },
        _sum: { durationMinutes: true },
      }),
      prisma.pmTimeEntry.count({ where: { project: { companyId }, userId, isRunning: true } }),
      prisma.pmProjectActivity.findMany({
        where: { project: { companyId, ...scopeWhere } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          user: { select: USER_SELECT },
          project: { select: { id: true, name: true, projectCode: true } },
        },
      }),
      prisma.pmProject.count({
        where: { ...projectWhere, endDate: { lt: now }, status: { in: ['planning', 'active', 'on_hold'] } },
      }),
      prisma.pmProject.aggregate({ where: projectWhere, _sum: { budget: true, estimatedCost: true } }),
    ]);

    const projectsByStatus = groupCountMap(statusGroups, 'status');
    const tasksByStatus = groupCountMap(taskGroups, 'status');
    const totalProjects = Object.values(projectsByStatus).reduce((a, b) => a + b, 0);
    const totalTasks = Object.values(tasksByStatus).reduce((a, b) => a + b, 0);

    res.json({
      success: true,
      data: {
        projects: {
          total: totalProjects,
          active: projectsByStatus.active || 0,
          planning: projectsByStatus.planning || 0,
          onHold: projectsByStatus.on_hold || 0,
          completed: projectsByStatus.completed || 0,
          cancelled: projectsByStatus.cancelled || 0,
          overdue: overdueProjects,
          archived: archivedCount,
          byStatus: projectsByStatus,
        },
        tasks: {
          total: totalTasks,
          open: totalTasks - (tasksByStatus.done || 0) - (tasksByStatus.cancelled || 0),
          completed: tasksByStatus.done || 0,
          overdue: overdueTasks,
          myOpen: myOpenTasks,
          byStatus: tasksByStatus,
        },
        milestones: { upcoming: upcomingMilestones, overdue: overdueMilestones },
        time: {
          minutesLast7Days: timeAgg._sum.durationMinutes || 0,
          hoursLast7Days: Math.round(((timeAgg._sum.durationMinutes || 0) / 60) * 100) / 100,
          myRunningTimers: runningTimers,
        },
        budget: {
          totalBudget: budgetAgg._sum.budget || 0,
          totalEstimatedCost: budgetAgg._sum.estimatedCost || 0,
        },
        recentActivity,
      },
      message: 'Project dashboard loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load project dashboard');
  }
};

// ─── Projects ────────────────────────────────────────────────────────────────

const getProjects = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { search, status, priority, managerId, customerId, archived = '0',
      sortBy = 'createdAt', sortDir = 'desc' } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const where = { companyId, isArchived: archived === '1' || archived === 'true', ...projectScopeWhere(req) };
    if (clean(status)) where.status = clean(status);
    if (clean(priority)) where.priority = clean(priority);
    if (clean(managerId)) where.managerId = clean(managerId);
    if (clean(customerId)) where.customerId = clean(customerId);
    if (clean(search)) {
      const q = clean(search);
      const searchOr = [
        { name: { contains: q, mode: 'insensitive' } },
        { projectCode: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
      where.AND = [{ OR: searchOr }];
    }

    const sortable = ['createdAt', 'updatedAt', 'name', 'projectCode', 'startDate', 'endDate', 'priority', 'status', 'progressPercent'];
    const orderBy = { [sortable.includes(sortBy) ? sortBy : 'createdAt']: sortDir === 'asc' ? 'asc' : 'desc' };

    const [projects, total] = await Promise.all([
      prisma.pmProject.findMany({
        where, orderBy, skip, take: limit,
        include: {
          manager: { select: USER_SELECT },
          customer: { select: { id: true, name: true } },
          _count: { select: { tasks: true, members: true, milestones: true } },
        },
      }),
      prisma.pmProject.count({ where }),
    ]);

    res.json({
      success: true,
      data: projects,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      message: 'Projects loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load projects');
  }
};

const getProjectById = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const project = await findProjectOrThrow(req, companyId, req.params.id, {
      include: {
        manager: { select: USER_SELECT },
        creator: { select: USER_SELECT },
        customer: { select: { id: true, name: true, email: true } },
        members: { include: { user: { select: USER_SELECT } } },
        milestones: { orderBy: { targetDate: 'asc' } },
        _count: { select: { tasks: true, timeEntries: true, attachments: true } },
      },
    });

    const [taskGroups, timeAgg] = await Promise.all([
      prisma.pmTask.groupBy({ by: ['status'], where: { projectId: project.id }, _count: { _all: true } }),
      prisma.pmTimeEntry.aggregate({ where: { projectId: project.id }, _sum: { durationMinutes: true } }),
    ]);

    res.json({
      success: true,
      data: {
        ...project,
        taskStats: groupCountMap(taskGroups, 'status'),
        totalMinutesLogged: timeAgg._sum.durationMinutes || 0,
      },
      message: 'Project loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load project');
  }
};

const createProject = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const b = req.body || {};

    const name = clean(b.name);
    if (!name) throw httpError(400, 'Project name is required');

    const startDate = parseDate(b.startDate, 'start date');
    const endDate = parseDate(b.endDate, 'end date');
    if (startDate && endDate && endDate < startDate) throw httpError(400, 'End date cannot be before start date');

    const managerId = clean(b.managerId);
    const customerId = clean(b.customerId);
    await assertUserInCompany(managerId, companyId, 'Manager');
    await assertCustomerInCompany(customerId, companyId);

    const memberIds = Array.isArray(b.memberIds) ? [...new Set(b.memberIds.map(clean).filter(Boolean))] : [];
    for (const mid of memberIds) await assertUserInCompany(mid, companyId, 'Member');

    const members = new Map();
    if (managerId) members.set(managerId, 'manager');
    for (const mid of memberIds) if (!members.has(mid)) members.set(mid, 'member');

    let projectCode = clean(b.projectCode);
    if (projectCode) {
      const dup = await prisma.pmProject.findFirst({ where: { companyId, projectCode }, select: { id: true } });
      if (dup) throw httpError(409, 'Project code already exists');
    } else {
      projectCode = await generateProjectCode(companyId);
    }

    const project = await prisma.pmProject.create({
      data: {
        companyId,
        projectCode,
        name,
        description: clean(b.description),
        customerId,
        managerId,
        startDate: startDate || null,
        endDate: endDate || null,
        budget: parseDecimal(b.budget),
        estimatedCost: parseDecimal(b.estimatedCost),
        priority: pickEnum(b.priority, PRIORITIES, 'priority') || 'medium',
        status: pickEnum(b.status, PROJECT_STATUSES, 'status') || 'planning',
        progressPercent: clampPercent(b.progressPercent),
        createdBy: userId,
        members: {
          create: [...members.entries()].map(([uid, role]) => ({ userId: uid, role })),
        },
      },
      include: { manager: { select: USER_SELECT }, members: true },
    });

    await logActivity({
      projectId: project.id, userId, action: 'project_created',
      message: `Project ${project.projectCode} "${project.name}" created`,
    });

    try {
      const { sendToUser } = require('../services/notificationService');
      const notifyIds = new Set([managerId, ...members.keys()].filter((id) => id && id !== userId));
      await Promise.all(
        [...notifyIds].map((uid) =>
          sendToUser({
            mongoUserId: uid,
            title: 'New project assigned',
            message: `${project.projectCode}: ${project.name}`,
            category: 'Projects',
            type: 'info',
            data: { projectId: project.id, href: `/projects/${project.id}` },
          }).catch(() => null)
        )
      );
    } catch (notifyErr) {
      console.warn('[Projects] notify failed:', notifyErr.message);
    }

    res.status(201).json({ success: true, data: project, message: 'Project created' });
  } catch (err) {
    sendError(res, err, 'Failed to create project');
  }
};

const updateProject = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const b = req.body || {};
    const existing = await findProjectOrThrow(req, companyId, req.params.id);

    const data = { updatedBy: userId };
    if (b.name !== undefined) {
      const name = clean(b.name);
      if (!name) throw httpError(400, 'Project name cannot be empty');
      data.name = name;
    }
    if (b.description !== undefined) data.description = clean(b.description);
    if (b.projectCode !== undefined) {
      const code = clean(b.projectCode);
      if (!code) throw httpError(400, 'Project code cannot be empty');
      if (code !== existing.projectCode) {
        const dup = await prisma.pmProject.findFirst({ where: { companyId, projectCode: code, id: { not: existing.id } }, select: { id: true } });
        if (dup) throw httpError(409, 'Project code already exists');
        data.projectCode = code;
      }
    }
    if (b.customerId !== undefined) {
      const customerId = clean(b.customerId);
      await assertCustomerInCompany(customerId, companyId);
      data.customerId = customerId;
    }
    if (b.managerId !== undefined) {
      const managerId = clean(b.managerId);
      await assertUserInCompany(managerId, companyId, 'Manager');
      data.managerId = managerId;
    }
    const startDate = parseDate(b.startDate, 'start date');
    const endDate = parseDate(b.endDate, 'end date');
    if (startDate !== undefined) data.startDate = startDate;
    if (endDate !== undefined) data.endDate = endDate;
    const effStart = startDate !== undefined ? startDate : existing.startDate;
    const effEnd = endDate !== undefined ? endDate : existing.endDate;
    if (effStart && effEnd && effEnd < effStart) throw httpError(400, 'End date cannot be before start date');

    if (b.budget !== undefined) data.budget = parseDecimal(b.budget);
    if (b.estimatedCost !== undefined) data.estimatedCost = parseDecimal(b.estimatedCost);
    if (b.priority !== undefined) data.priority = pickEnum(b.priority, PRIORITIES, 'priority');
    if (b.status !== undefined) data.status = pickEnum(b.status, PROJECT_STATUSES, 'status');
    if (b.progressPercent !== undefined) data.progressPercent = clampPercent(b.progressPercent);
    if (b.isArchived !== undefined) data.isArchived = b.isArchived === true || b.isArchived === 'true' || b.isArchived === 1;

    const project = await prisma.pmProject.update({
      where: { id: existing.id },
      data,
      include: { manager: { select: USER_SELECT } },
    });

    if (data.managerId) {
      await prisma.pmProjectMember.upsert({
        where: { projectId_userId: { projectId: project.id, userId: data.managerId } },
        create: { projectId: project.id, userId: data.managerId, role: 'manager' },
        update: { role: 'manager' },
      });
    }

    const statusChanged = data.status && data.status !== existing.status;
    await logActivity({
      projectId: project.id, userId,
      action: statusChanged ? 'status_changed' : 'project_updated',
      message: statusChanged
        ? `Project status changed from ${existing.status} to ${data.status}`
        : `Project "${project.name}" updated`,
    });

    res.json({ success: true, data: project, message: 'Project updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update project');
  }
};

/** Soft delete → archive the project (isArchived = true). */
const deleteProject = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const existing = await findProjectOrThrow(req, companyId, req.params.id);

    await prisma.pmProject.update({
      where: { id: existing.id },
      data: { isArchived: true, updatedBy: userId },
    });
    await logActivity({
      projectId: existing.id, userId, action: 'project_archived',
      message: `Project "${existing.name}" archived`,
    });

    res.json({ success: true, data: { id: existing.id, isArchived: true }, message: 'Project archived' });
  } catch (err) {
    sendError(res, err, 'Failed to archive project');
  }
};

// ─── Tasks ───────────────────────────────────────────────────────────────────

const getProjectTasks = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const project = await findProjectOrThrow(req, companyId, req.params.id, { select: { id: true } });
    const { status, assigneeId, priority, parentTaskId, search, mine } = req.query;

    const where = { projectId: project.id };
    if (clean(status)) where.status = clean(status);
    if (clean(priority)) where.priority = clean(priority);
    if (clean(assigneeId)) where.assigneeId = clean(assigneeId);
    if (mine === '1' || req.permissionScope === 'OWN') where.assigneeId = userId;
    if (parentTaskId === 'root') where.parentTaskId = null;
    else if (clean(parentTaskId)) where.parentTaskId = clean(parentTaskId);
    if (clean(search)) where.title = { contains: clean(search), mode: 'insensitive' };

    const tasks = await prisma.pmTask.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        assignee: { select: USER_SELECT },
        _count: { select: { subtasks: true, comments: true, checklistItems: true } },
      },
    });

    res.json({ success: true, data: tasks, message: 'Tasks loaded' });
  } catch (err) {
    sendError(res, err, 'Failed to load tasks');
  }
};

const createTask = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const b = req.body || {};
    const project = await findProjectOrThrow(req, companyId, req.params.id, { select: { id: true, name: true } });

    const title = clean(b.title);
    if (!title) throw httpError(400, 'Task title is required');

    const assigneeId = clean(b.assigneeId);
    await assertUserInCompany(assigneeId, companyId, 'Assignee');

    const parentTaskId = clean(b.parentTaskId);
    if (parentTaskId) {
      const parent = await prisma.pmTask.findFirst({ where: { id: parentTaskId, projectId: project.id }, select: { id: true } });
      if (!parent) throw httpError(400, 'Parent task not found in this project');
    }

    const startDate = parseDate(b.startDate, 'start date');
    const dueDate = parseDate(b.dueDate, 'due date');
    if (startDate && dueDate && dueDate < startDate) throw httpError(400, 'Due date cannot be before start date');

    let sortOrder = parseInt(b.sortOrder, 10);
    if (!Number.isFinite(sortOrder)) {
      const agg = await prisma.pmTask.aggregate({ where: { projectId: project.id, parentTaskId }, _max: { sortOrder: true } });
      sortOrder = (agg._max.sortOrder ?? -1) + 1;
    }

    const task = await prisma.pmTask.create({
      data: {
        projectId: project.id,
        parentTaskId,
        title,
        description: clean(b.description),
        assigneeId,
        priority: pickEnum(b.priority, PRIORITIES, 'priority') || 'medium',
        status: pickEnum(b.status, TASK_STATUSES, 'status') || 'todo',
        startDate: startDate || null,
        dueDate: dueDate || null,
        progressPercent: clampPercent(b.progressPercent),
        estimatedHours: parseDecimal(b.estimatedHours),
        actualHours: parseDecimal(b.actualHours),
        sortOrder,
        createdBy: userId,
      },
      include: { assignee: { select: USER_SELECT } },
    });

    await logActivity({
      projectId: project.id, taskId: task.id, userId, action: 'task_created',
      message: `Task "${task.title}" created`,
    });
    await recalcProjectProgress(project.id);

    res.status(201).json({ success: true, data: task, message: 'Task created' });
  } catch (err) {
    sendError(res, err, 'Failed to create task');
  }
};

const updateTask = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const b = req.body || {};

    const existing = await prisma.pmTask.findFirst({
      where: { id: req.params.taskId, project: { companyId, ...projectScopeWhere(req) } },
    });
    if (!existing) throw httpError(404, 'Task not found');
    if (req.permissionScope === 'OWN' && existing.assigneeId !== userId && existing.createdBy !== userId) {
      throw httpError(403, 'Access denied. Your access is restricted to OWN records only.');
    }

    const data = {};
    if (b.title !== undefined) {
      const title = clean(b.title);
      if (!title) throw httpError(400, 'Task title cannot be empty');
      data.title = title;
    }
    if (b.description !== undefined) data.description = clean(b.description);
    if (b.assigneeId !== undefined) {
      const assigneeId = clean(b.assigneeId);
      await assertUserInCompany(assigneeId, companyId, 'Assignee');
      data.assigneeId = assigneeId;
    }
    if (b.priority !== undefined) data.priority = pickEnum(b.priority, PRIORITIES, 'priority');
    if (b.status !== undefined) {
      data.status = pickEnum(b.status, TASK_STATUSES, 'status');
      if (data.status === 'done' && b.progressPercent === undefined) data.progressPercent = 100;
    }
    const startDate = parseDate(b.startDate, 'start date');
    const dueDate = parseDate(b.dueDate, 'due date');
    if (startDate !== undefined) data.startDate = startDate;
    if (dueDate !== undefined) data.dueDate = dueDate;
    if (b.progressPercent !== undefined) data.progressPercent = clampPercent(b.progressPercent);
    if (b.estimatedHours !== undefined) data.estimatedHours = parseDecimal(b.estimatedHours);
    if (b.actualHours !== undefined) data.actualHours = parseDecimal(b.actualHours);
    if (b.sortOrder !== undefined) data.sortOrder = parseInt(b.sortOrder, 10) || 0;

    const task = await prisma.pmTask.update({
      where: { id: existing.id },
      data,
      include: { assignee: { select: USER_SELECT } },
    });

    const statusChanged = data.status && data.status !== existing.status;
    await logActivity({
      projectId: existing.projectId, taskId: existing.id, userId,
      action: statusChanged ? 'task_status_changed' : 'task_updated',
      message: statusChanged
        ? `Task "${task.title}" moved from ${existing.status} to ${data.status}`
        : `Task "${task.title}" updated`,
    });
    if (data.status !== undefined || data.progressPercent !== undefined) {
      await recalcProjectProgress(existing.projectId);
    }

    res.json({ success: true, data: task, message: 'Task updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update task');
  }
};

// ─── Shared helpers (Phase 2+) ───────────────────────────────────────────────

const MEMBER_ROLES = ['manager', 'member', 'viewer'];
const MILESTONE_STATUSES = ['pending', 'in_progress', 'completed', 'missed'];

function toBool(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

/** Task inside the active company (and project scope); optionally pinned to a project. */
async function findTaskOrThrow(req, companyId, taskId, projectId) {
  const task = await prisma.pmTask.findFirst({
    where: {
      id: taskId,
      ...(projectId ? { projectId } : {}),
      project: { companyId, ...projectScopeWhere(req) },
    },
  });
  if (!task) throw httpError(404, 'Task not found');
  if (req.permissionScope === 'OWN') {
    const uid = getUserId(req);
    if (task.assigneeId !== uid && task.createdBy !== uid) {
      throw httpError(403, 'Access denied. Your access is restricted to OWN records only.');
    }
  }
  return task;
}

/** Keep PmTask.actualHours in sync with its logged (non-running) time entries. */
async function syncTaskActualHours(taskId) {
  if (!taskId) return;
  try {
    const agg = await prisma.pmTimeEntry.aggregate({
      where: { taskId, isRunning: false },
      _sum: { durationMinutes: true },
    });
    const hours = Math.round(((agg._sum.durationMinutes || 0) / 60) * 100) / 100;
    await prisma.pmTask.update({ where: { id: taskId }, data: { actualHours: hours } });
  } catch (e) {
    console.warn('[Projects] actualHours sync failed:', e.message);
  }
}

function minutesBetween(from, to) {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
}

// ─── Members (projects.teams.*) ──────────────────────────────────────────────

const getMembers = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const project = await findProjectOrThrow(req, companyId, req.params.id, { select: { id: true, managerId: true } });
    const members = await prisma.pmProjectMember.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: USER_SELECT } },
    });
    res.json({
      success: true,
      data: members.map((m) => ({ ...m, isProjectManager: m.userId === project.managerId })),
      message: 'Project members loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load project members');
  }
};

const addMember = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const actorId = getUserId(req);
    const b = req.body || {};
    const project = await findProjectOrThrow(req, companyId, req.params.id, { select: { id: true, name: true } });

    const memberUserId = clean(b.userId);
    if (!memberUserId) throw httpError(400, 'userId is required');
    await assertUserInCompany(memberUserId, companyId, 'Member');
    const role = pickEnum(b.role, MEMBER_ROLES, 'role') || 'member';

    const existing = await prisma.pmProjectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: memberUserId } },
    });
    const member = await prisma.pmProjectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: memberUserId } },
      create: { projectId: project.id, userId: memberUserId, role },
      update: { role },
      include: { user: { select: USER_SELECT } },
    });

    await logActivity({
      projectId: project.id, userId: actorId,
      action: existing ? 'member_role_changed' : 'member_added',
      message: existing
        ? `Member role changed to ${role}`
        : `${member.user?.firstName || 'User'} ${member.user?.lastName || ''} added to the project as ${role}`.replace(/\s+/g, ' ').trim(),
      meta: { memberUserId, role },
    });

    res.status(existing ? 200 : 201).json({
      success: true, data: member, message: existing ? 'Member role updated' : 'Member added',
    });
  } catch (err) {
    sendError(res, err, 'Failed to add project member');
  }
};

const removeMember = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const actorId = getUserId(req);
    const project = await findProjectOrThrow(req, companyId, req.params.id, { select: { id: true, managerId: true } });

    const member = await prisma.pmProjectMember.findFirst({
      where: { id: req.params.memberId, projectId: project.id },
    });
    if (!member) throw httpError(404, 'Project member not found');
    if (project.managerId && member.userId === project.managerId) {
      throw httpError(400, 'The project manager cannot be removed. Assign a different manager first.');
    }

    await prisma.pmProjectMember.delete({ where: { id: member.id } });
    await logActivity({
      projectId: project.id, userId: actorId, action: 'member_removed',
      message: 'A member was removed from the project', meta: { memberUserId: member.userId },
    });

    res.json({ success: true, data: { id: member.id }, message: 'Member removed' });
  } catch (err) {
    sendError(res, err, 'Failed to remove project member');
  }
};

// ─── Milestones (projects.milestones.*) ──────────────────────────────────────

const getMilestones = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const project = await findProjectOrThrow(req, companyId, req.params.id, { select: { id: true } });
    const where = { projectId: project.id };
    if (clean(req.query.status)) where.status = clean(req.query.status);
    const milestones = await prisma.pmMilestone.findMany({
      where,
      orderBy: [{ targetDate: 'asc' }, { createdAt: 'asc' }],
    });
    const now = new Date();
    res.json({
      success: true,
      data: milestones.map((m) => ({
        ...m,
        isOverdue: !!m.targetDate && m.targetDate < now && ['pending', 'in_progress'].includes(m.status),
      })),
      message: 'Milestones loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load milestones');
  }
};

const createMilestone = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const b = req.body || {};
    const project = await findProjectOrThrow(req, companyId, req.params.id, { select: { id: true } });

    const title = clean(b.title);
    if (!title) throw httpError(400, 'Milestone title is required');
    const status = pickEnum(b.status, MILESTONE_STATUSES, 'status') || 'pending';

    const milestone = await prisma.pmMilestone.create({
      data: {
        projectId: project.id,
        title,
        description: clean(b.description),
        targetDate: parseDate(b.targetDate, 'target date') || null,
        status,
        completedAt: status === 'completed' ? new Date() : null,
      },
    });

    await logActivity({
      projectId: project.id, userId, action: 'milestone_created',
      message: `Milestone "${milestone.title}" created`, meta: { milestoneId: milestone.id },
    });

    res.status(201).json({ success: true, data: milestone, message: 'Milestone created' });
  } catch (err) {
    sendError(res, err, 'Failed to create milestone');
  }
};

async function findMilestoneOrThrow(req, companyId, milestoneId) {
  const milestone = await prisma.pmMilestone.findFirst({
    where: { id: milestoneId, project: { companyId, ...projectScopeWhere(req) } },
  });
  if (!milestone) throw httpError(404, 'Milestone not found');
  return milestone;
}

const updateMilestone = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const b = req.body || {};
    const existing = await findMilestoneOrThrow(req, companyId, req.params.milestoneId);

    const data = {};
    if (b.title !== undefined) {
      const title = clean(b.title);
      if (!title) throw httpError(400, 'Milestone title cannot be empty');
      data.title = title;
    }
    if (b.description !== undefined) data.description = clean(b.description);
    const targetDate = parseDate(b.targetDate, 'target date');
    if (targetDate !== undefined) data.targetDate = targetDate;
    if (b.status !== undefined) {
      data.status = pickEnum(b.status, MILESTONE_STATUSES, 'status');
      if (data.status === 'completed' && existing.status !== 'completed') data.completedAt = new Date();
      if (data.status !== 'completed') data.completedAt = null;
    }

    const milestone = await prisma.pmMilestone.update({ where: { id: existing.id }, data });

    const statusChanged = data.status && data.status !== existing.status;
    await logActivity({
      projectId: existing.projectId, userId,
      action: statusChanged ? `milestone_${data.status}` : 'milestone_updated',
      message: statusChanged
        ? `Milestone "${milestone.title}" marked ${data.status.replace('_', ' ')}`
        : `Milestone "${milestone.title}" updated`,
      meta: { milestoneId: milestone.id },
    });

    res.json({ success: true, data: milestone, message: 'Milestone updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update milestone');
  }
};

const deleteMilestone = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const existing = await findMilestoneOrThrow(req, companyId, req.params.milestoneId);
    await prisma.pmMilestone.delete({ where: { id: existing.id } });
    await logActivity({
      projectId: existing.projectId, userId, action: 'milestone_deleted',
      message: `Milestone "${existing.title}" deleted`,
    });
    res.json({ success: true, data: { id: existing.id }, message: 'Milestone deleted' });
  } catch (err) {
    sendError(res, err, 'Failed to delete milestone');
  }
};

// ─── Time tracking (projects.time.*) ─────────────────────────────────────────

const TIME_INCLUDE = {
  user: { select: USER_SELECT },
  task: { select: { id: true, title: true } },
};

/** OWN scope → own entries only. */
function timeScopeWhere(req) {
  return req.permissionScope === 'OWN' ? { userId: getUserId(req) } : {};
}

/** Stop any running timers of a user (a user can only run one timer at a time). */
async function stopRunningTimers(userId, projectIdsFilter) {
  const running = await prisma.pmTimeEntry.findMany({
    where: { userId, isRunning: true, ...(projectIdsFilter ? { projectId: { in: projectIdsFilter } } : {}) },
  });
  const now = new Date();
  for (const r of running) {
    await prisma.pmTimeEntry.update({
      where: { id: r.id },
      data: { isRunning: false, endedAt: now, durationMinutes: minutesBetween(r.startedAt, now) },
    });
    await syncTaskActualHours(r.taskId);
  }
}

const getTimeEntries = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const project = await findProjectOrThrow(req, companyId, req.params.id, { select: { id: true } });
    const { userId: filterUser, taskId, running, from, to } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const where = { projectId: project.id, ...timeScopeWhere(req) };
    if (clean(filterUser) && req.permissionScope !== 'OWN') where.userId = clean(filterUser);
    if (clean(taskId)) where.taskId = clean(taskId);
    if (running === '1' || running === 'true') where.isRunning = true;
    const fromD = parseDate(clean(from) || undefined, 'from date');
    const toD = parseDate(clean(to) || undefined, 'to date');
    if (fromD || toD) {
      where.startedAt = {};
      if (fromD) where.startedAt.gte = fromD;
      if (toD) where.startedAt.lte = toD;
    }

    const [entries, total, agg] = await Promise.all([
      prisma.pmTimeEntry.findMany({
        where, orderBy: { startedAt: 'desc' }, skip, take: limit, include: TIME_INCLUDE,
      }),
      prisma.pmTimeEntry.count({ where }),
      prisma.pmTimeEntry.aggregate({ where, _sum: { durationMinutes: true } }),
    ]);

    res.json({
      success: true,
      data: entries,
      summary: { totalMinutes: agg._sum.durationMinutes || 0, totalHours: Math.round(((agg._sum.durationMinutes || 0) / 60) * 100) / 100 },
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      message: 'Time entries loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load time entries');
  }
};

/**
 * Create a time entry.
 *  - Timer:  { isRunning: true, taskId?, description?, startedAt? }  → starts a running timer.
 *  - Manual: { startedAt, endedAt } or { startedAt, durationMinutes } (or { date, durationMinutes }).
 */
const createTimeEntry = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const actorId = getUserId(req);
    const b = req.body || {};
    const project = await findProjectOrThrow(req, companyId, req.params.id, { select: { id: true } });

    let entryUserId = actorId;
    if (clean(b.userId) && clean(b.userId) !== actorId) {
      if (req.permissionScope === 'OWN') throw httpError(403, 'You can only log time for yourself');
      await assertUserInCompany(clean(b.userId), companyId, 'User');
      entryUserId = clean(b.userId);
    }

    const taskId = clean(b.taskId);
    if (taskId) {
      const task = await prisma.pmTask.findFirst({ where: { id: taskId, projectId: project.id }, select: { id: true } });
      if (!task) throw httpError(400, 'Task not found in this project');
    }

    const isTimer = toBool(b.isRunning);
    const startedAt = parseDate(b.startedAt ?? b.date, 'start time') || (isTimer ? new Date() : null);
    if (!startedAt) throw httpError(400, 'startedAt is required for manual time entries');

    let data;
    if (isTimer) {
      await stopRunningTimers(entryUserId);
      data = {
        projectId: project.id, taskId, userId: entryUserId, startedAt, endedAt: null,
        durationMinutes: 0, isRunning: true, source: 'timer', description: clean(b.description),
      };
    } else {
      let endedAt = parseDate(b.endedAt, 'end time') || null;
      let duration;
      if (endedAt) {
        if (endedAt <= startedAt) throw httpError(400, 'End time must be after start time');
        duration = minutesBetween(startedAt, endedAt);
      } else {
        duration = parseInt(b.durationMinutes, 10);
        if (!Number.isFinite(duration) || duration <= 0) {
          throw httpError(400, 'Provide endedAt or a positive durationMinutes');
        }
        endedAt = new Date(startedAt.getTime() + duration * 60000);
      }
      if (duration > 24 * 60) throw httpError(400, 'A single time entry cannot exceed 24 hours');
      data = {
        projectId: project.id, taskId, userId: entryUserId, startedAt, endedAt,
        durationMinutes: duration, isRunning: false, source: 'manual', description: clean(b.description),
      };
    }

    const entry = await prisma.pmTimeEntry.create({ data, include: TIME_INCLUDE });
    if (!isTimer) await syncTaskActualHours(taskId);

    await logActivity({
      projectId: project.id, taskId, userId: actorId,
      action: isTimer ? 'timer_started' : 'time_logged',
      message: isTimer ? 'Timer started' : `${entry.durationMinutes} minute(s) logged`,
      meta: { timeEntryId: entry.id },
    });

    res.status(201).json({ success: true, data: entry, message: isTimer ? 'Timer started' : 'Time entry created' });
  } catch (err) {
    sendError(res, err, 'Failed to create time entry');
  }
};

async function findTimeEntryOrThrow(req, companyId, entryId) {
  const entry = await prisma.pmTimeEntry.findFirst({
    where: { id: entryId, project: { companyId, ...projectScopeWhere(req) }, ...timeScopeWhere(req) },
  });
  if (!entry) throw httpError(404, 'Time entry not found');
  return entry;
}

const stopTimeEntry = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const actorId = getUserId(req);
    const existing = await findTimeEntryOrThrow(req, companyId, req.params.entryId);
    if (!existing.isRunning) throw httpError(400, 'This timer is not running');

    const endedAt = new Date();
    const entry = await prisma.pmTimeEntry.update({
      where: { id: existing.id },
      data: { isRunning: false, endedAt, durationMinutes: minutesBetween(existing.startedAt, endedAt) },
      include: TIME_INCLUDE,
    });
    await syncTaskActualHours(entry.taskId);
    await logActivity({
      projectId: entry.projectId, taskId: entry.taskId, userId: actorId, action: 'timer_stopped',
      message: `Timer stopped (${entry.durationMinutes} minute(s))`, meta: { timeEntryId: entry.id },
    });

    res.json({ success: true, data: entry, message: 'Timer stopped' });
  } catch (err) {
    sendError(res, err, 'Failed to stop timer');
  }
};

const updateTimeEntry = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const b = req.body || {};
    const existing = await findTimeEntryOrThrow(req, companyId, req.params.entryId);
    if (existing.isRunning) throw httpError(400, 'Stop the timer before editing the entry');

    const data = {};
    if (b.description !== undefined) data.description = clean(b.description);
    if (b.taskId !== undefined) {
      const taskId = clean(b.taskId);
      if (taskId) {
        const task = await prisma.pmTask.findFirst({ where: { id: taskId, projectId: existing.projectId }, select: { id: true } });
        if (!task) throw httpError(400, 'Task not found in this project');
      }
      data.taskId = taskId;
    }

    const startedAt = b.startedAt !== undefined ? parseDate(b.startedAt, 'start time') : existing.startedAt;
    if (!startedAt) throw httpError(400, 'startedAt cannot be empty');
    let endedAt = b.endedAt !== undefined ? parseDate(b.endedAt, 'end time') : existing.endedAt;
    if (b.startedAt !== undefined || b.endedAt !== undefined || b.durationMinutes !== undefined) {
      let duration;
      if (b.durationMinutes !== undefined && b.endedAt === undefined) {
        duration = parseInt(b.durationMinutes, 10);
        if (!Number.isFinite(duration) || duration <= 0) throw httpError(400, 'durationMinutes must be positive');
        endedAt = new Date(startedAt.getTime() + duration * 60000);
      } else {
        if (!endedAt) throw httpError(400, 'endedAt cannot be empty');
        if (endedAt <= startedAt) throw httpError(400, 'End time must be after start time');
        duration = minutesBetween(startedAt, endedAt);
      }
      if (duration > 24 * 60) throw httpError(400, 'A single time entry cannot exceed 24 hours');
      data.startedAt = startedAt;
      data.endedAt = endedAt;
      data.durationMinutes = duration;
    }

    const entry = await prisma.pmTimeEntry.update({ where: { id: existing.id }, data, include: TIME_INCLUDE });
    await syncTaskActualHours(existing.taskId);
    if (entry.taskId !== existing.taskId) await syncTaskActualHours(entry.taskId);

    res.json({ success: true, data: entry, message: 'Time entry updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update time entry');
  }
};

const deleteTimeEntry = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const existing = await findTimeEntryOrThrow(req, companyId, req.params.entryId);
    await prisma.pmTimeEntry.delete({ where: { id: existing.id } });
    await syncTaskActualHours(existing.taskId);
    res.json({ success: true, data: { id: existing.id }, message: 'Time entry deleted' });
  } catch (err) {
    sendError(res, err, 'Failed to delete time entry');
  }
};

// ─── Activity feed (projects.communication.view) ─────────────────────────────

const getProjectActivities = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const project = await findProjectOrThrow(req, companyId, req.params.id, { select: { id: true } });
    const { page, limit, skip } = parsePagination(req.query, { limit: 30 });
    const where = { projectId: project.id };
    if (clean(req.query.taskId)) where.taskId = clean(req.query.taskId);
    if (clean(req.query.action)) where.action = clean(req.query.action);

    const [activities, total] = await Promise.all([
      prisma.pmProjectActivity.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: limit,
        include: { user: { select: USER_SELECT }, task: { select: { id: true, title: true } } },
      }),
      prisma.pmProjectActivity.count({ where }),
    ]);

    res.json({
      success: true, data: activities,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      message: 'Project activity loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load project activity');
  }
};

// ─── Task comments (projects.communication.*) ────────────────────────────────

const getTaskComments = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const project = await findProjectOrThrow(req, companyId, req.params.id, { select: { id: true } });
    const task = await findTaskOrThrow(req, companyId, req.params.taskId, project.id);
    const comments = await prisma.pmTaskComment.findMany({
      where: { taskId: task.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: USER_SELECT } },
    });
    res.json({ success: true, data: comments, message: 'Comments loaded' });
  } catch (err) {
    sendError(res, err, 'Failed to load comments');
  }
};

const createTaskComment = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const project = await findProjectOrThrow(req, companyId, req.params.id, { select: { id: true } });
    const task = await findTaskOrThrow(req, companyId, req.params.taskId, project.id);

    const body = clean(req.body?.body ?? req.body?.comment ?? req.body?.message);
    if (!body) throw httpError(400, 'Comment body is required');

    const comment = await prisma.pmTaskComment.create({
      data: { taskId: task.id, userId, body },
      include: { user: { select: USER_SELECT } },
    });
    await logActivity({
      projectId: project.id, taskId: task.id, userId, action: 'comment_added',
      message: `Comment added on task "${task.title}"`, meta: { commentId: comment.id },
    });

    res.status(201).json({ success: true, data: comment, message: 'Comment added' });
  } catch (err) {
    sendError(res, err, 'Failed to add comment');
  }
};

// ─── Task checklist (projects.tasks.*) ───────────────────────────────────────

const getTaskChecklist = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const project = await findProjectOrThrow(req, companyId, req.params.id, { select: { id: true } });
    const task = await findTaskOrThrow(req, companyId, req.params.taskId, project.id);
    const items = await prisma.pmTaskChecklistItem.findMany({
      where: { taskId: task.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const done = items.filter((i) => i.isDone).length;
    res.json({
      success: true, data: items,
      summary: { total: items.length, done, percent: items.length ? Math.round((done / items.length) * 100) : 0 },
      message: 'Checklist loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load checklist');
  }
};

const createChecklistItem = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    const project = await findProjectOrThrow(req, companyId, req.params.id, { select: { id: true } });
    const task = await findTaskOrThrow(req, companyId, req.params.taskId, project.id);

    const title = clean(req.body?.title);
    if (!title) throw httpError(400, 'Checklist item title is required');

    let sortOrder = parseInt(req.body?.sortOrder, 10);
    if (!Number.isFinite(sortOrder)) {
      const agg = await prisma.pmTaskChecklistItem.aggregate({ where: { taskId: task.id }, _max: { sortOrder: true } });
      sortOrder = (agg._max.sortOrder ?? -1) + 1;
    }

    const item = await prisma.pmTaskChecklistItem.create({
      data: { taskId: task.id, title, sortOrder, isDone: toBool(req.body?.isDone) },
    });
    await logActivity({
      projectId: project.id, taskId: task.id, userId, action: 'checklist_item_added',
      message: `Checklist item "${title}" added to task "${task.title}"`,
    });

    res.status(201).json({ success: true, data: item, message: 'Checklist item added' });
  } catch (err) {
    sendError(res, err, 'Failed to add checklist item');
  }
};

/** Toggle / edit a checklist item (body: { isDone?, title?, sortOrder? }; no isDone ⇒ toggles). */
const updateChecklistItem = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const b = req.body || {};
    const item = await prisma.pmTaskChecklistItem.findFirst({
      where: { id: req.params.itemId, task: { project: { companyId, ...projectScopeWhere(req) } } },
      include: { task: { select: { id: true, assigneeId: true, createdBy: true } } },
    });
    if (!item) throw httpError(404, 'Checklist item not found');
    if (req.permissionScope === 'OWN') {
      const uid = getUserId(req);
      if (item.task.assigneeId !== uid && item.task.createdBy !== uid) {
        throw httpError(403, 'Access denied. Your access is restricted to OWN records only.');
      }
    }

    const data = {};
    if (b.isDone !== undefined) data.isDone = toBool(b.isDone);
    else if (b.title === undefined && b.sortOrder === undefined) data.isDone = !item.isDone;
    if (b.title !== undefined) {
      const title = clean(b.title);
      if (!title) throw httpError(400, 'Checklist item title cannot be empty');
      data.title = title;
    }
    if (b.sortOrder !== undefined) data.sortOrder = parseInt(b.sortOrder, 10) || 0;

    const updated = await prisma.pmTaskChecklistItem.update({ where: { id: item.id }, data });
    res.json({ success: true, data: updated, message: 'Checklist item updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update checklist item');
  }
};

// ─── Settings (projects.settings.*) ──────────────────────────────────────────

const DEFAULT_PM_SETTINGS = {
  defaultStatuses: PROJECT_STATUSES,
  defaultPriorities: PRIORITIES,
  customFields: [],
};

const getProjectSettings = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const s = await prisma.pmProjectSettings.findUnique({ where: { companyId } });
    res.json({
      success: true,
      data: s
        ? {
          ...s,
          defaultStatuses: s.defaultStatuses ?? DEFAULT_PM_SETTINGS.defaultStatuses,
          defaultPriorities: s.defaultPriorities ?? DEFAULT_PM_SETTINGS.defaultPriorities,
          customFields: s.customFields ?? DEFAULT_PM_SETTINGS.customFields,
        }
        : { companyId, ...DEFAULT_PM_SETTINGS },
      message: 'Project settings loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load project settings');
  }
};

const updateProjectSettings = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const b = req.body || {};
    const data = {};

    const stringList = (v, label) => {
      if (!Array.isArray(v)) throw httpError(400, `${label} must be an array of strings`);
      const list = [...new Set(v.map(clean).filter(Boolean))];
      if (!list.length) throw httpError(400, `${label} cannot be empty`);
      return list;
    };
    if (b.defaultStatuses !== undefined) data.defaultStatuses = stringList(b.defaultStatuses, 'defaultStatuses');
    if (b.defaultPriorities !== undefined) data.defaultPriorities = stringList(b.defaultPriorities, 'defaultPriorities');
    if (b.customFields !== undefined) {
      if (!Array.isArray(b.customFields) && (typeof b.customFields !== 'object' || b.customFields === null)) {
        throw httpError(400, 'customFields must be an array or object');
      }
      data.customFields = b.customFields;
    }

    const settings = await prisma.pmProjectSettings.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
    res.json({ success: true, data: settings, message: 'Project settings updated' });
  } catch (err) {
    sendError(res, err, 'Failed to update project settings');
  }
};

// ─── Reports (projects.reports.view) ─────────────────────────────────────────

const getReportsSummary = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const now = new Date();
    const scopeWhere = projectScopeWhere(req);
    const { from, to, projectId } = req.query;
    const fromD = parseDate(clean(from) || undefined, 'from date');
    const toD = parseDate(clean(to) || undefined, 'to date');

    const projectWhere = { companyId, isArchived: false, ...scopeWhere };
    if (clean(projectId)) projectWhere.id = clean(projectId);
    const taskWhere = { project: projectWhere };
    const timeWhere = { project: { companyId, ...scopeWhere, ...(clean(projectId) ? { id: clean(projectId) } : {}) } };
    if (req.permissionScope === 'OWN') timeWhere.userId = getUserId(req);
    if (fromD || toD) {
      timeWhere.startedAt = {};
      if (fromD) timeWhere.startedAt.gte = fromD;
      if (toD) timeWhere.startedAt.lte = toD;
    }

    const [
      projectStatusGroups, projectPriorityGroups, taskStatusGroups, taskPriorityGroups,
      overdueTasks, overdueProjects, budgetAgg, timeAgg, timeByUserRows, timeByProjectRows,
      workloadRows, milestoneGroups, overdueMilestones, topProjects, overdueTaskList,
    ] = await Promise.all([
      prisma.pmProject.groupBy({ by: ['status'], where: projectWhere, _count: { _all: true } }),
      prisma.pmProject.groupBy({ by: ['priority'], where: projectWhere, _count: { _all: true } }),
      prisma.pmTask.groupBy({ by: ['status'], where: taskWhere, _count: { _all: true } }),
      prisma.pmTask.groupBy({ by: ['priority'], where: taskWhere, _count: { _all: true } }),
      prisma.pmTask.count({ where: { ...taskWhere, dueDate: { lt: now }, status: { notIn: CLOSED_TASK_STATUSES } } }),
      prisma.pmProject.count({
        where: { ...projectWhere, endDate: { lt: now }, status: { in: ['planning', 'active', 'on_hold'] } },
      }),
      prisma.pmProject.aggregate({ where: projectWhere, _sum: { budget: true, estimatedCost: true }, _avg: { progressPercent: true } }),
      prisma.pmTimeEntry.aggregate({ where: timeWhere, _sum: { durationMinutes: true }, _count: { _all: true } }),
      prisma.pmTimeEntry.groupBy({ by: ['userId'], where: timeWhere, _sum: { durationMinutes: true } }),
      prisma.pmTimeEntry.groupBy({ by: ['projectId'], where: timeWhere, _sum: { durationMinutes: true } }),
      prisma.pmTask.groupBy({
        by: ['assigneeId'],
        where: { ...taskWhere, assigneeId: { not: null }, status: { notIn: CLOSED_TASK_STATUSES } },
        _count: { _all: true },
      }),
      prisma.pmMilestone.groupBy({ by: ['status'], where: { project: projectWhere }, _count: { _all: true } }),
      prisma.pmMilestone.count({
        where: { project: projectWhere, status: { in: ['pending', 'in_progress'] }, targetDate: { lt: now } },
      }),
      prisma.pmProject.findMany({
        where: { ...projectWhere, status: { in: ['planning', 'active', 'on_hold'] } },
        orderBy: { endDate: 'asc' },
        take: 10,
        select: {
          id: true, projectCode: true, name: true, status: true, priority: true,
          progressPercent: true, startDate: true, endDate: true, budget: true,
          manager: { select: USER_SELECT },
        },
      }),
      prisma.pmTask.findMany({
        where: { ...taskWhere, dueDate: { lt: now }, status: { notIn: CLOSED_TASK_STATUSES } },
        orderBy: { dueDate: 'asc' },
        take: 10,
        select: {
          id: true, title: true, dueDate: true, status: true, priority: true, projectId: true,
          assignee: { select: USER_SELECT }, project: { select: { id: true, name: true, projectCode: true } },
        },
      }),
    ]);

    const userIds = [...new Set([...timeByUserRows.map((r) => r.userId), ...workloadRows.map((r) => r.assigneeId)])];
    const projectIds = timeByProjectRows.map((r) => r.projectId);
    const [users, projects] = await Promise.all([
      userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: USER_SELECT }) : [],
      projectIds.length
        ? prisma.pmProject.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true, projectCode: true } })
        : [],
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const projectMap = new Map(projects.map((p) => [p.id, p]));
    const hours = (m) => Math.round(((m || 0) / 60) * 100) / 100;

    const projectsByStatus = groupCountMap(projectStatusGroups, 'status');
    const tasksByStatus = groupCountMap(taskStatusGroups, 'status');
    const totalProjects = Object.values(projectsByStatus).reduce((a, b) => a + b, 0);
    const totalTasks = Object.values(tasksByStatus).reduce((a, b) => a + b, 0);
    const completedTasks = tasksByStatus.done || 0;

    res.json({
      success: true,
      data: {
        range: { from: fromD || null, to: toD || null },
        projects: {
          total: totalProjects,
          byStatus: projectsByStatus,
          byPriority: groupCountMap(projectPriorityGroups, 'priority'),
          overdue: overdueProjects,
          averageProgress: Math.round(budgetAgg._avg.progressPercent || 0),
        },
        tasks: {
          total: totalTasks,
          completed: completedTasks,
          open: totalTasks - completedTasks - (tasksByStatus.cancelled || 0),
          overdue: overdueTasks,
          completionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
          byStatus: tasksByStatus,
          byPriority: groupCountMap(taskPriorityGroups, 'priority'),
        },
        milestones: {
          byStatus: groupCountMap(milestoneGroups, 'status'),
          overdue: overdueMilestones,
        },
        budget: {
          totalBudget: budgetAgg._sum.budget || 0,
          totalEstimatedCost: budgetAgg._sum.estimatedCost || 0,
        },
        time: {
          totalMinutes: timeAgg._sum.durationMinutes || 0,
          totalHours: hours(timeAgg._sum.durationMinutes),
          entries: timeAgg._count._all,
          byUser: timeByUserRows
            .map((r) => ({ user: userMap.get(r.userId) || { id: r.userId }, minutes: r._sum.durationMinutes || 0, hours: hours(r._sum.durationMinutes) }))
            .sort((a, b) => b.minutes - a.minutes),
          byProject: timeByProjectRows
            .map((r) => ({ project: projectMap.get(r.projectId) || { id: r.projectId }, minutes: r._sum.durationMinutes || 0, hours: hours(r._sum.durationMinutes) }))
            .sort((a, b) => b.minutes - a.minutes),
        },
        workload: workloadRows
          .map((r) => ({ user: userMap.get(r.assigneeId) || { id: r.assigneeId }, openTasks: r._count._all }))
          .sort((a, b) => b.openTasks - a.openTasks),
        upcomingProjects: topProjects,
        overdueTasks: overdueTaskList,
      },
      message: 'Project report loaded',
    });
  } catch (err) {
    sendError(res, err, 'Failed to load project report');
  }
};

module.exports = {
  getDashboard,
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  getProjectTasks,
  createTask,
  updateTask,
  // Members
  getMembers,
  addMember,
  removeMember,
  // Milestones
  getMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  // Time tracking
  getTimeEntries,
  createTimeEntry,
  stopTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
  // Communication
  getProjectActivities,
  getTaskComments,
  createTaskComment,
  // Checklist
  getTaskChecklist,
  createChecklistItem,
  updateChecklistItem,
  // Settings & reports
  getProjectSettings,
  updateProjectSettings,
  getReportsSummary,
};
