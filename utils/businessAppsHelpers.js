'use strict';

/**
 * Shared helpers for the Business Applications Suite controllers
 * (Project Management, Meetings, Notice Board, Appointment Booking).
 */
const { requireSingleCompany, userHasCompanyAccess } = require('./companyAccess');

/** Active company id; throws an error with status 400 if none / "All Companies" mode. */
function getCompanyId(req) {
  const companyId = requireSingleCompany(req); // throws 400 when All Companies / none selected
  if (!companyId) {
    const err = new Error('Company context required');
    err.status = 400;
    throw err;
  }
  return companyId;
}

function getUserId(req) {
  return req.user?.id || req.user?._id || null;
}

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

/** Uniform error responder: `{ success:false, message }`. */
function sendError(res, err, fallbackMessage = 'Request failed') {
  const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) console.error('[BusinessApps]', err);
  return res.status(status).json({
    success: false,
    ...(err?.code ? { code: err.code } : {}),
    message: status >= 500 ? err?.message || fallbackMessage : err.message,
  });
}

function parsePagination(query, defaults = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || defaults.limit || 25));
  return { page, limit, skip: (page - 1) * limit };
}

function clean(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s === 'undefined' || s === 'null') return null;
  return s;
}

/** Parse a date-ish value. Returns undefined when absent, null when explicitly empty, throws 400 if invalid. */
function parseDate(value, label = 'date') {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw httpError(400, `Invalid ${label}`);
  return d;
}

function parseIntOr(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clampPercent(value, fallback = 0) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, n));
}

function parseDecimal(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw httpError(400, 'Invalid numeric value');
  return n;
}

function pickEnum(value, allowed, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const v = String(value).trim().toLowerCase();
  if (!allowed.includes(v)) {
    throw httpError(400, `Invalid ${label}. Allowed: ${allowed.join(', ')}`);
  }
  return v;
}

/** Ensure a user id belongs to the active company (membership or primary company). */
async function assertUserInCompany(userId, companyId, label = 'User') {
  if (!userId) return;
  const ok = await userHasCompanyAccess(userId, companyId);
  if (!ok) throw httpError(400, `${label} does not belong to the active company`);
}

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

/** Convert prisma groupBy result to `{ key: count }` map. */
function groupCountMap(rows, key) {
  const out = {};
  for (const r of rows) out[r[key]] = r._count?._all ?? r._count ?? 0;
  return out;
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

module.exports = {
  getCompanyId,
  getUserId,
  httpError,
  sendError,
  parsePagination,
  clean,
  parseDate,
  parseIntOr,
  clampPercent,
  parseDecimal,
  pickEnum,
  assertUserInCompany,
  startOfDay,
  endOfDay,
  startOfMonth,
  groupCountMap,
  slugify,
};
