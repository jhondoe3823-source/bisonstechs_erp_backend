'use strict';

/**
 * Company-scoped Sales Agents settings (toggles + monthly commission slabs).
 * Used by Settings → Sales Agents and sale invoice / POS agent flows.
 */

const prisma = require('../prisma/client');

const DEFAULT_SETTINGS = {
  enableSalesAgents: true,
  trackCommission: true,
  agentRequired: false,
  customCommissionSlabs: false,
  commissionSlabs: [],
};

function normalizeSlabs(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const cleaned = list
    .map((row) => ({
      fromAmount: Math.max(0, Number(row?.fromAmount ?? row?.from ?? 0) || 0),
      commissionPercent: Math.max(0, Number(row?.commissionPercent ?? row?.percent ?? 0) || 0),
    }))
    .filter((row) => Number.isFinite(row.fromAmount) && Number.isFinite(row.commissionPercent));

  cleaned.sort((a, b) => a.fromAmount - b.fromAmount);

  // Deduplicate identical fromAmount — keep the last entered rate
  const byFrom = new Map();
  for (const row of cleaned) {
    byFrom.set(row.fromAmount, row);
  }
  return Array.from(byFrom.values()).sort((a, b) => a.fromAmount - b.fromAmount);
}

function serialize(setting) {
  return {
    id: setting.id,
    companyId: setting.companyId,
    enableSalesAgents: Boolean(setting.enableSalesAgents),
    trackCommission: Boolean(setting.trackCommission),
    agentRequired: Boolean(setting.agentRequired),
    customCommissionSlabs: Boolean(setting.customCommissionSlabs),
    commissionSlabs: normalizeSlabs(setting.commissionSlabs),
    updatedAt: setting.updatedAt,
  };
}

async function ensureSettings(companyId, client = prisma) {
  if (!companyId) {
    throw Object.assign(new Error('companyId is required for sales agent settings'), {
      statusCode: 400,
    });
  }

  let setting = await client.companySalesAgentSetting.findUnique({
    where: { companyId },
  });

  if (!setting) {
    try {
      setting = await client.companySalesAgentSetting.create({
        data: {
          companyId,
          ...DEFAULT_SETTINGS,
          commissionSlabs: [],
        },
      });
    } catch (err) {
      if (err?.code === 'P2002') {
        setting = await client.companySalesAgentSetting.findUnique({ where: { companyId } });
      } else {
        throw err;
      }
    }
  }

  if (!setting) {
    throw Object.assign(new Error('Failed to initialize sales agent settings'), {
      statusCode: 500,
    });
  }

  return setting;
}

async function getSettings(companyId) {
  const setting = await ensureSettings(companyId);
  return serialize(setting);
}

async function updateSettings(companyId, payload = {}) {
  await ensureSettings(companyId);

  const data = {};
  if (payload.enableSalesAgents !== undefined) {
    data.enableSalesAgents = Boolean(payload.enableSalesAgents);
  }
  if (payload.trackCommission !== undefined) {
    data.trackCommission = Boolean(payload.trackCommission);
  }
  if (payload.agentRequired !== undefined) {
    data.agentRequired = Boolean(payload.agentRequired);
  }
  if (payload.customCommissionSlabs !== undefined) {
    data.customCommissionSlabs = Boolean(payload.customCommissionSlabs);
  }
  if (payload.commissionSlabs !== undefined) {
    data.commissionSlabs = normalizeSlabs(payload.commissionSlabs);
  }

  // If agent feature is off, required cannot stay on
  if (data.enableSalesAgents === false) {
    data.agentRequired = false;
  }

  const updated = await prisma.companySalesAgentSetting.update({
    where: { companyId },
    data,
  });

  return serialize(updated);
}

/**
 * Highest slab whose fromAmount <= monthlySales wins for the whole month.
 * Below the smallest slab → 0%.
 */
function resolveSlabRate(monthlySales, slabs) {
  const amount = Math.max(0, Number(monthlySales) || 0);
  const sorted = normalizeSlabs(slabs);
  if (!sorted.length) return 0;

  let rate = 0;
  for (const slab of sorted) {
    if (amount >= slab.fromAmount) {
      rate = slab.commissionPercent;
    } else {
      break;
    }
  }
  return rate;
}

/**
 * Preview helper for Settings "Check a month of Rs".
 */
function previewSlabForAmount(monthlySales, slabs) {
  const sorted = normalizeSlabs(slabs);
  const rate = resolveSlabRate(monthlySales, sorted);
  const amount = Math.max(0, Number(monthlySales) || 0);
  const matched = [...sorted].reverse().find((s) => amount >= s.fromAmount) || null;
  return {
    monthlySales: amount,
    commissionPercent: rate,
    matchedSlab: matched,
    earnsNothing: sorted.length > 0 && amount < sorted[0].fromAmount,
  };
}

/**
 * Sum of posted/active sales invoices for an agent in a calendar month.
 */
async function getAgentMonthlySales(companyId, salesPersonId, atDate = new Date(), client = prisma) {
  if (!companyId || !salesPersonId) return 0;

  const ref = atDate instanceof Date ? atDate : new Date(atDate);
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);

  const agg = await client.salesInvoice.aggregate({
    where: {
      companyId,
      salesPersonId,
      isActive: true,
      isDeleted: false,
      invoiceStatus: { notIn: ['Cancelled', 'Void'] },
      invoiceDate: { gte: start, lt: end },
    },
    _sum: { grandTotal: true },
  });

  return Number(agg._sum?.grandTotal || 0);
}

/**
 * Resolve commission % for an agent on a sale (flat or slab).
 * Optional overridePercent wins when trackCommission allows per-invoice edit.
 */
async function resolveAgentCommission({
  companyId,
  salesPersonId,
  grandTotal = 0,
  overridePercent,
  atDate = new Date(),
  client = prisma,
}) {
  const settings = serialize(await ensureSettings(companyId, client));

  if (!settings.enableSalesAgents) {
    return {
      settings,
      salesPerson: null,
      commissionPercent: 0,
      commissionAmount: 0,
    };
  }

  if (!salesPersonId) {
    if (settings.agentRequired) {
      throw Object.assign(new Error('A sales agent is required for this sale'), {
        statusCode: 400,
      });
    }
    return {
      settings,
      salesPerson: null,
      commissionPercent: 0,
      commissionAmount: 0,
    };
  }

  const salesPerson = await client.salesperson.findFirst({
    where: { id: salesPersonId, companyId },
  });

  if (!salesPerson) {
    throw Object.assign(new Error('Sales agent not found'), { statusCode: 404 });
  }

  let commissionPercent = Number(salesPerson.commissionRate) || 0;
  const type = String(salesPerson.commissionType || 'flat').toLowerCase();

  if (
    type === 'slab' &&
    settings.customCommissionSlabs &&
    Array.isArray(settings.commissionSlabs) &&
    settings.commissionSlabs.length
  ) {
    const monthlySales = await getAgentMonthlySales(companyId, salesPersonId, atDate, client);
    // Include this sale's amount so crossing a slab mid-month lifts the rate
    const projected = monthlySales + Math.max(0, Number(grandTotal) || 0);
    commissionPercent = resolveSlabRate(projected, settings.commissionSlabs);
  }

  if (settings.trackCommission && overridePercent !== undefined && overridePercent !== null) {
    commissionPercent = Math.max(0, Number(overridePercent) || 0);
  }

  if (!settings.trackCommission) {
    commissionPercent = 0;
  }

  const total = Math.max(0, Number(grandTotal) || 0);
  const commissionAmount = Math.round(((total * commissionPercent) / 100) * 100) / 100;

  return {
    settings,
    salesPerson,
    commissionPercent,
    commissionAmount,
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  normalizeSlabs,
  resolveSlabRate,
  previewSlabForAmount,
  getSettings,
  updateSettings,
  ensureSettings,
  getAgentMonthlySales,
  resolveAgentCommission,
};
