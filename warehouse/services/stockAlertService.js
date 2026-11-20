'use strict';

/**
 * Inventory alerts → Notification inbox (+ push).
 * - Low stock when currentStock <= minimumStock
 * - Expiry when product expiryDate is past or within EXPIRY_SOON_DAYS
 */

const prisma = require('../../prisma/client');
const { sendToUsers } = require('../../services/notificationService');

const EXPIRY_SOON_DAYS = 30;
const DEDUPE_HOURS = 24;

async function getCompanyNotifyUserIds(companyId) {
  if (!companyId) return [];
  const memberships = await prisma.companyMembership.findMany({
    where: { companyId, isActive: true },
    select: { userId: true },
  });
  const ids = memberships.map((m) => m.userId).filter(Boolean);
  if (ids.length) return [...new Set(ids)];

  const users = await prisma.user.findMany({
    where: { companyId, isActive: true },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

async function alreadyNotified(userIds, alertKey) {
  if (!userIds.length || !alertKey) return true;
  const since = new Date(Date.now() - DEDUPE_HOURS * 60 * 60 * 1000);
  const hit = await prisma.notification.findFirst({
    where: {
      userId: { in: userIds },
      category: 'Inventory',
      createdAt: { gte: since },
      data: { path: ['alertKey'], equals: alertKey },
    },
    select: { id: true },
  });
  return Boolean(hit);
}

async function notifyCompany(companyId, payload) {
  const userIds = await getCompanyNotifyUserIds(companyId);
  if (!userIds.length) return { skipped: true, reason: 'no_users' };

  const alertKey = payload.data?.alertKey;
  if (alertKey && (await alreadyNotified(userIds, alertKey))) {
    return { skipped: true, reason: 'deduped', alertKey };
  }

  await sendToUsers(userIds, {
    title: payload.title,
    message: payload.message,
    type: payload.type || 'warning',
    category: 'Inventory',
    data: payload.data || {},
    collapseId: alertKey || undefined,
  });
  return { sent: true, userCount: userIds.length, alertKey };
}

function daysUntil(date) {
  if (!date) return null;
  const end = new Date(date);
  end.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((end - now) / (1000 * 60 * 60 * 24));
}

/**
 * Evaluate low-stock + expiry for one product and notify company users.
 * Safe to call fire-and-forget after stock/product writes.
 */
async function evaluateProductStockAlerts(productId, opts = {}) {
  try {
    if (!productId) return { skipped: true };

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        isActive: true,
        isDeleted: false,
        ...(opts.companyId ? { companyId: opts.companyId } : {}),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        companyId: true,
        currentStock: true,
        minimumStock: true,
        stockUnitName: true,
        expiryDate: true,
        hasExpiry: true,
        isExpiryManaged: true,
      },
    });

    if (!product?.companyId) return { skipped: true, reason: 'product_not_found' };

    const unit = product.stockUnitName || 'Pcs';
    const results = [];

    const minStock = Number(product.minimumStock) || 0;
    const qty = Number(product.currentStock) || 0;
    if (minStock > 0 && qty <= minStock) {
      const alertKey = `low-stock:${product.id}:${minStock}`;
      const r = await notifyCompany(product.companyId, {
        title: 'Low stock alert',
        message: `${product.name}${product.sku ? ` (${product.sku})` : ''} is at ${qty} ${unit} (minimum ${minStock} ${unit}).`,
        type: qty <= 0 ? 'error' : 'warning',
        data: {
          alertKey,
          alertType: 'low_stock',
          productId: product.id,
          sku: product.sku,
          currentStock: qty,
          minimumStock: minStock,
          link: '/warehouse/reports/low-stock',
        },
      });
      results.push({ kind: 'low_stock', ...r });
    }

    const expiry = product.expiryDate;
    if (expiry && (product.hasExpiry || product.isExpiryManaged || true)) {
      const days = daysUntil(expiry);
      if (days != null && days < 0) {
        const alertKey = `expiry-expired:${product.id}:${new Date(expiry).toISOString().slice(0, 10)}`;
        const r = await notifyCompany(product.companyId, {
          title: 'Product expired',
          message: `${product.name}${product.sku ? ` (${product.sku})` : ''} expired on ${new Date(expiry).toLocaleDateString()}. Stock on hand: ${qty} ${unit}.`,
          type: 'error',
          data: {
            alertKey,
            alertType: 'expiry_expired',
            productId: product.id,
            expiryDate: expiry,
            link: '/warehouse/reports/expiry',
          },
        });
        results.push({ kind: 'expiry_expired', ...r });
      } else if (days != null && days <= EXPIRY_SOON_DAYS) {
        const alertKey = `expiry-soon:${product.id}:${new Date(expiry).toISOString().slice(0, 10)}`;
        const r = await notifyCompany(product.companyId, {
          title: 'Expiry approaching',
          message: `${product.name}${product.sku ? ` (${product.sku})` : ''} expires in ${days} day${days === 1 ? '' : 's'} (${new Date(expiry).toLocaleDateString()}). Stock: ${qty} ${unit}.`,
          type: 'warning',
          data: {
            alertKey,
            alertType: 'expiry_soon',
            productId: product.id,
            expiryDate: expiry,
            daysLeft: days,
            link: '/warehouse/reports/expiry',
          },
        });
        results.push({ kind: 'expiry_soon', ...r });
      }
    }

    return { productId: product.id, results };
  } catch (err) {
    console.error('[stockAlertService] evaluateProductStockAlerts:', err.message);
    return { error: err.message };
  }
}

/** Non-blocking wrapper for controllers. */
function scheduleProductStockAlerts(productId, opts = {}) {
  if (!productId) return;
  setImmediate(() => {
    evaluateProductStockAlerts(productId, opts).catch((err) => {
      console.error('[stockAlertService] schedule failed:', err.message);
    });
  });
}

module.exports = {
  EXPIRY_SOON_DAYS,
  evaluateProductStockAlerts,
  scheduleProductStockAlerts,
  getCompanyNotifyUserIds,
};
