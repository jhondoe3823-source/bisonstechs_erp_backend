'use strict';

/**
 * Company-scoped document numbering.
 * Settings → Invoice Numbers drives prefixes + counters for sales, purchases,
 * import, export and related create flows.
 */

const prisma = require('../prisma/client');

/** Canonical document types shown in Settings and used by allocateNextNumber. */
const DOCUMENT_TYPE_CATALOG = [
  // Domestic / warehouse
  { documentType: 'quotation', label: 'Quotation', prefix: 'QT', padLength: 4, sortOrder: 10 },
  { documentType: 'sale-order', label: 'Sale Order', prefix: 'SO', padLength: 4, sortOrder: 20 },
  { documentType: 'delivery', label: 'Delivery Note', prefix: 'DLV', padLength: 4, sortOrder: 30 },
  { documentType: 'sale-invoice', label: 'Sale Invoice', prefix: 'INV', padLength: 4, sortOrder: 40 },
  { documentType: 'sale-payment', label: 'Sales Payment', prefix: 'SP', padLength: 4, sortOrder: 45 },
  { documentType: 'sale-return', label: 'Sales Return', prefix: 'SR', padLength: 4, sortOrder: 46 },
  { documentType: 'sale-refund', label: 'Sales Refund', prefix: 'SRF', padLength: 4, sortOrder: 47 },
  { documentType: 'purchase-requisition', label: 'Purchase Requisition', prefix: 'PRQ', padLength: 4, sortOrder: 50 },
  { documentType: 'purchase-order', label: 'Purchase Order', prefix: 'PO', padLength: 4, sortOrder: 60 },
  { documentType: 'grn', label: 'Goods Receiving', prefix: 'GRN', padLength: 4, sortOrder: 70 },
  { documentType: 'purchase-invoice', label: 'Purchase Invoice', prefix: 'PINV', padLength: 4, sortOrder: 80 },
  { documentType: 'purchase-payment', label: 'Purchase Payment', prefix: 'PP', padLength: 4, sortOrder: 85 },
  { documentType: 'purchase-return', label: 'Purchase Return', prefix: 'PRET', padLength: 4, sortOrder: 86 },
  { documentType: 'purchase-refund', label: 'Purchase Refund', prefix: 'PRF', padLength: 4, sortOrder: 87 },
  // Import
  { documentType: 'import-rfq', label: 'Import RFQ', prefix: 'RFQ', padLength: 4, sortOrder: 110 },
  { documentType: 'import-supplier-quotation', label: 'Import Supplier Quotation', prefix: 'ISQ', padLength: 4, sortOrder: 120 },
  { documentType: 'import-purchase-order', label: 'Import Purchase Order', prefix: 'IPO', padLength: 4, sortOrder: 130 },
  { documentType: 'import-shipment', label: 'Import Shipment', prefix: 'ISHP', padLength: 4, sortOrder: 140 },
  { documentType: 'import-customs', label: 'Import Customs Clearance', prefix: 'ICC', padLength: 4, sortOrder: 150 },
  { documentType: 'import-grn', label: 'Import GRN', prefix: 'IGRN', padLength: 4, sortOrder: 160 },
  { documentType: 'import-supplier-bill', label: 'Import Supplier Bill', prefix: 'IBILL', padLength: 4, sortOrder: 170 },
  // Export
  { documentType: 'export-inquiry', label: 'Export Inquiry', prefix: 'EINQ', padLength: 4, sortOrder: 210 },
  { documentType: 'export-quotation', label: 'Export Quotation', prefix: 'EQT', padLength: 4, sortOrder: 220 },
  { documentType: 'export-sales-order', label: 'Export Sales Order', prefix: 'ESO', padLength: 4, sortOrder: 230 },
  { documentType: 'export-proforma', label: 'Export Proforma Invoice', prefix: 'EPI', padLength: 4, sortOrder: 240 },
  { documentType: 'export-commercial-invoice', label: 'Export Commercial Invoice', prefix: 'ECI', padLength: 4, sortOrder: 250 },
  { documentType: 'export-packing-list', label: 'Export Packing List', prefix: 'EPL', padLength: 4, sortOrder: 260 },
  { documentType: 'export-shipment', label: 'Export Shipment', prefix: 'ESHP', padLength: 4, sortOrder: 270 },
  { documentType: 'export-customs', label: 'Export Shipping Bill', prefix: 'ESB', padLength: 4, sortOrder: 280 },
  { documentType: 'export-dispatch', label: 'Export Dispatch', prefix: 'EDISP', padLength: 4, sortOrder: 290 },
  { documentType: 'export-receipt', label: 'Export Receipt', prefix: 'XRCP', padLength: 4, sortOrder: 300 },
  { documentType: 'export-expense', label: 'Export Expense', prefix: 'XEXP', padLength: 4, sortOrder: 310 },
];

/** Map legacy / module prefixes → documentType for allocate-by-prefix helpers. */
const PREFIX_TO_DOCUMENT_TYPE = {
  QT: 'quotation',
  SO: 'sale-order',
  DLV: 'delivery',
  SI: 'sale-invoice',
  INV: 'sale-invoice',
  SP: 'sale-payment',
  SR: 'sale-return',
  SRF: 'sale-refund',
  PRQ: 'purchase-requisition',
  PR: 'purchase-requisition',
  PO: 'purchase-order',
  GRN: 'grn',
  PI: 'purchase-invoice',
  PINV: 'purchase-invoice',
  PP: 'purchase-payment',
  PRET: 'purchase-return',
  PRF: 'purchase-refund',
  RFQ: 'import-rfq',
  ISQ: 'import-supplier-quotation',
  IPO: 'import-purchase-order',
  ISHP: 'import-shipment',
  ICC: 'import-customs',
  IGRN: 'import-grn',
  IBILL: 'import-supplier-bill',
  EINQ: 'export-inquiry',
  EQT: 'export-quotation',
  ESO: 'export-sales-order',
  EPI: 'export-proforma',
  ECI: 'export-commercial-invoice',
  EPL: 'export-packing-list',
  ESHP: 'export-shipment',
  ESB: 'export-customs',
  EDISP: 'export-dispatch',
  XRCP: 'export-receipt',
  XEXP: 'export-expense',
};

function normalizePrefix(value, fallback = 'DOC') {
  const cleaned = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return cleaned || fallback;
}

function formatDocumentNumber(prefix, number, padLength = 4) {
  const p = normalizePrefix(prefix);
  const n = Math.max(1, Number(number) || 1);
  const pad = Math.max(1, Math.min(8, Number(padLength) || 4));
  return `${p}-${String(n).padStart(pad, '0')}`;
}

function db() {
  return prisma;
}

async function loadSettingWithSeries(client, companyId) {
  return client.companyDocumentNumberingSetting.findUnique({
    where: { companyId },
    include: { series: { orderBy: { sortOrder: 'asc' } } },
  });
}

async function ensureCompanySeries(companyId, client = db()) {
  if (!companyId) {
    throw Object.assign(new Error('companyId is required for document numbering'), {
      statusCode: 400,
    });
  }

  let setting = await loadSettingWithSeries(client, companyId);

  if (!setting) {
    try {
      // Upsert avoids most races; still catch P2002 if two creates collide.
      setting = await client.companyDocumentNumberingSetting.upsert({
        where: { companyId },
        create: {
          companyId,
          allowManualInvoiceNumber: true,
          series: {
            create: DOCUMENT_TYPE_CATALOG.map((d) => ({
              companyId,
              documentType: d.documentType,
              label: d.label,
              prefix: d.prefix,
              nextNumber: 1,
              padLength: d.padLength,
              sortOrder: d.sortOrder,
              isActive: true,
            })),
          },
        },
        update: {},
        include: { series: { orderBy: { sortOrder: 'asc' } } },
      });
    } catch (err) {
      if (err?.code === 'P2002') {
        setting = await loadSettingWithSeries(client, companyId);
      } else {
        throw err;
      }
    }
  }

  if (!setting) {
    throw Object.assign(new Error('Failed to initialize document numbering for company'), {
      statusCode: 500,
    });
  }

  const existingTypes = new Set((setting.series || []).map((s) => s.documentType));
  const missing = DOCUMENT_TYPE_CATALOG.filter((d) => !existingTypes.has(d.documentType));
  if (missing.length) {
    await client.documentNumberSeries.createMany({
      data: missing.map((d) => ({
        companyId,
        settingId: setting.id,
        documentType: d.documentType,
        label: d.label,
        prefix: d.prefix,
        nextNumber: 1,
        padLength: d.padLength,
        sortOrder: d.sortOrder,
        isActive: true,
      })),
      skipDuplicates: true,
    });
    setting = await loadSettingWithSeries(client, companyId);
  }

  return setting;
}

function serializeSettings(setting) {
  return {
    id: setting.id,
    companyId: setting.companyId,
    allowManualInvoiceNumber: Boolean(setting.allowManualInvoiceNumber),
    series: (setting.series || []).map((s) => ({
      id: s.id,
      documentType: s.documentType,
      label: s.label,
      prefix: s.prefix,
      nextNumber: s.nextNumber,
      padLength: s.padLength,
      sortOrder: s.sortOrder,
      isActive: s.isActive,
      preview: formatDocumentNumber(s.prefix, s.nextNumber, s.padLength),
    })),
    updatedAt: setting.updatedAt,
  };
}

async function getSettings(companyId) {
  const setting = await ensureCompanySeries(companyId);
  return serializeSettings(setting);
}

async function updateSettings(companyId, payload = {}) {
  const setting = await ensureCompanySeries(companyId);
  const allowManual =
    payload.allowManualInvoiceNumber != null
      ? Boolean(payload.allowManualInvoiceNumber)
      : setting.allowManualInvoiceNumber;

  const seriesInput = Array.isArray(payload.series) ? payload.series : [];

  await prisma.$transaction(async (tx) => {
    await tx.companyDocumentNumberingSetting.update({
      where: { id: setting.id },
      data: { allowManualInvoiceNumber: allowManual },
    });

    for (const row of seriesInput) {
      const documentType = String(row.documentType || '').trim();
      if (!documentType) continue;

      const catalog = DOCUMENT_TYPE_CATALOG.find((d) => d.documentType === documentType);
      const prefix = normalizePrefix(row.prefix, catalog?.prefix || 'DOC');
      const nextNumber = Math.max(1, parseInt(row.nextNumber, 10) || 1);
      const padLength = Math.max(1, Math.min(8, parseInt(row.padLength, 10) || catalog?.padLength || 4));
      const label = String(row.label || catalog?.label || documentType).trim();
      const sortOrder =
        Number.isFinite(Number(row.sortOrder)) && row.sortOrder != null
          ? Number(row.sortOrder)
          : catalog?.sortOrder || 0;
      const isActive = row.isActive == null ? true : Boolean(row.isActive);

      await tx.documentNumberSeries.upsert({
        where: {
          companyId_documentType: { companyId, documentType },
        },
        create: {
          companyId,
          settingId: setting.id,
          documentType,
          label,
          prefix,
          nextNumber,
          padLength,
          sortOrder,
          isActive,
        },
        update: {
          label,
          prefix,
          nextNumber,
          padLength,
          sortOrder,
          isActive,
        },
      });
    }
  });

  return getSettings(companyId);
}

/**
 * Atomically allocate the next number for a document type.
 * @param {string} companyId
 * @param {string} documentType
 * @param {{ tx?: any, manualNumber?: string|null }} [opts]
 * @returns {Promise<string>} formatted document number e.g. SO-0001
 */
async function allocateNextNumber(companyId, documentType, opts = {}) {
  const { tx, manualNumber } = opts;
  const client = tx || prisma;
  const type = String(documentType || '').trim();
  if (!companyId) {
    throw Object.assign(new Error('companyId is required to allocate a document number'), {
      statusCode: 400,
    });
  }
  if (!type) {
    throw Object.assign(new Error('documentType is required to allocate a document number'), {
      statusCode: 400,
    });
  }

  // Ensure defaults exist (uses root client if nested tx can't create setting easily)
  if (!tx) {
    await ensureCompanySeries(companyId, client);
  } else {
    // Inside an outer tx: ensure series row exists without nested interactive txn
    const existing = await client.documentNumberSeries.findUnique({
      where: { companyId_documentType: { companyId, documentType: type } },
    });
    if (!existing) {
      await ensureCompanySeries(companyId, client);
    }
  }

  const setting = await client.companyDocumentNumberingSetting.findUnique({
    where: { companyId },
  });

  const manual = manualNumber != null ? String(manualNumber).trim() : '';
  if (manual) {
    if (setting && !setting.allowManualInvoiceNumber) {
      throw Object.assign(
        new Error('Manual document numbers are disabled in Settings → Invoice Numbers'),
        { statusCode: 400 }
      );
    }
    // Per settings UX: custom number used as-is; counter does not advance
    return manual;
  }

  const series = await client.documentNumberSeries.findUnique({
    where: { companyId_documentType: { companyId, documentType: type } },
  });

  if (!series || !series.isActive) {
    const catalog = DOCUMENT_TYPE_CATALOG.find((d) => d.documentType === type);
    const prefix = catalog?.prefix || type.toUpperCase().slice(0, 4);
    // Last-resort fallback without DB (should be rare)
    const stamp = Date.now().toString().slice(-6);
    return `${prefix}-${stamp}`;
  }

  const allocated = series.nextNumber;
  await client.documentNumberSeries.update({
    where: { id: series.id },
    data: { nextNumber: allocated + 1 },
  });

  return formatDocumentNumber(series.prefix, allocated, series.padLength);
}

/**
 * Allocate by legacy prefix (import/export helpers).
 */
async function allocateNextNumberByPrefix(companyId, prefix, opts = {}) {
  const normalized = normalizePrefix(prefix);
  const documentType = PREFIX_TO_DOCUMENT_TYPE[normalized];
  if (documentType) {
    return allocateNextNumber(companyId, documentType, opts);
  }
  // Unknown prefix: still create an ad-hoc series under that prefix as type
  const adHocType = `custom-${normalized.toLowerCase()}`;
  const client = opts.tx || prisma;
  let setting = await client.companyDocumentNumberingSetting.findUnique({
    where: { companyId },
  });
  if (!setting) {
    await ensureCompanySeries(companyId, opts.tx ? prisma : client);
    setting = await client.companyDocumentNumberingSetting.findUnique({
      where: { companyId },
    });
  }
  await client.documentNumberSeries.upsert({
    where: { companyId_documentType: { companyId, documentType: adHocType } },
    create: {
      companyId,
      settingId: setting.id,
      documentType: adHocType,
      label: normalized,
      prefix: normalized,
      nextNumber: 1,
      padLength: 4,
      sortOrder: 900,
      isActive: true,
    },
    update: {},
  });
  return allocateNextNumber(companyId, adHocType, opts);
}

async function isManualAllowed(companyId, client = db()) {
  if (!companyId) return true;
  const setting = await client.companyDocumentNumberingSetting.findUnique({
    where: { companyId },
    select: { allowManualInvoiceNumber: true },
  });
  if (!setting) return true;
  return Boolean(setting.allowManualInvoiceNumber);
}

module.exports = {
  DOCUMENT_TYPE_CATALOG,
  PREFIX_TO_DOCUMENT_TYPE,
  formatDocumentNumber,
  ensureCompanySeries,
  getSettings,
  updateSettings,
  allocateNextNumber,
  allocateNextNumberByPrefix,
  isManualAllowed,
};
