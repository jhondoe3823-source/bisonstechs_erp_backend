const prisma = require('../../prisma/client');
const { randomUUID } = require('crypto');
const { toNumber, roundTo } = require('./inventoryMath');

/**
 * Default company UOM catalog.
 * Product pickers (Setting category stockUnit) are synced from symbol || name.
 */
const DEFAULT_UOMS = [
  // Count / packaging
  { code: 'PCS', name: 'Pieces', symbol: 'Pcs', decimalPlaces: 0, isBase: true },
  { code: 'EA', name: 'Each', symbol: 'Ea', decimalPlaces: 0, isBase: true },
  { code: 'UNIT', name: 'Unit', symbol: 'Unit', decimalPlaces: 0, isBase: true },
  { code: 'SET', name: 'Set', symbol: 'Set', decimalPlaces: 0, isBase: false },
  { code: 'PAIR', name: 'Pair', symbol: 'Pair', decimalPlaces: 0, isBase: false },
  { code: 'DOZ', name: 'Dozen', symbol: 'Doz', decimalPlaces: 0, isBase: false },
  { code: 'GROSS', name: 'Gross', symbol: 'Gross', decimalPlaces: 0, isBase: false },
  { code: 'BOX', name: 'Box', symbol: 'Box', decimalPlaces: 0, isBase: false },
  { code: 'PKT', name: 'Packet', symbol: 'Pkt', decimalPlaces: 0, isBase: false },
  { code: 'PACK', name: 'Pack', symbol: 'Pack', decimalPlaces: 0, isBase: false },
  { code: 'BAG', name: 'Bag', symbol: 'Bag', decimalPlaces: 0, isBase: false },
  { code: 'CTN', name: 'Carton', symbol: 'Ctn', decimalPlaces: 0, isBase: false },
  { code: 'CASE', name: 'Case', symbol: 'Case', decimalPlaces: 0, isBase: false },
  { code: 'BDL', name: 'Bundle', symbol: 'Bdl', decimalPlaces: 0, isBase: false },
  { code: 'PLT', name: 'Pallet', symbol: 'Plt', decimalPlaces: 0, isBase: false },
  { code: 'ROLL', name: 'Roll', symbol: 'Roll', decimalPlaces: 0, isBase: false },
  { code: 'SHEET', name: 'Sheet', symbol: 'Sheet', decimalPlaces: 0, isBase: false },
  { code: 'REAM', name: 'Ream', symbol: 'Ream', decimalPlaces: 0, isBase: false },
  // Containers
  { code: 'BTL', name: 'Bottle', symbol: 'Btl', decimalPlaces: 0, isBase: false },
  { code: 'CAN', name: 'Can', symbol: 'Can', decimalPlaces: 0, isBase: false },
  { code: 'JAR', name: 'Jar', symbol: 'Jar', decimalPlaces: 0, isBase: false },
  { code: 'TIN', name: 'Tin', symbol: 'Tin', decimalPlaces: 0, isBase: false },
  { code: 'TUBE', name: 'Tube', symbol: 'Tube', decimalPlaces: 0, isBase: false },
  { code: 'DRM', name: 'Drum', symbol: 'Drum', decimalPlaces: 0, isBase: false },
  { code: 'BARREL', name: 'Barrel', symbol: 'Barrel', decimalPlaces: 0, isBase: false },
  { code: 'JERRY', name: 'Jerry Can', symbol: 'Jerry', decimalPlaces: 0, isBase: false },
  // Weight
  { code: 'MG', name: 'Milligram', symbol: 'mg', decimalPlaces: 3, isBase: false },
  { code: 'G', name: 'Gram', symbol: 'G', decimalPlaces: 3, isBase: false },
  { code: 'KG', name: 'Kilogram', symbol: 'KG', decimalPlaces: 3, isBase: true },
  { code: 'TON', name: 'Metric Ton', symbol: 'Ton', decimalPlaces: 3, isBase: false },
  { code: 'LB', name: 'Pound', symbol: 'lb', decimalPlaces: 3, isBase: false },
  { code: 'OZ', name: 'Ounce', symbol: 'oz', decimalPlaces: 3, isBase: false },
  // Volume
  { code: 'ML', name: 'Millilitre', symbol: 'ML', decimalPlaces: 3, isBase: false },
  { code: 'LTR', name: 'Litre', symbol: 'LTR', decimalPlaces: 3, isBase: true },
  { code: 'GAL', name: 'Gallon', symbol: 'Gal', decimalPlaces: 3, isBase: false },
  { code: 'CC', name: 'Cubic Centimetre', symbol: 'cc', decimalPlaces: 3, isBase: false },
  { code: 'CBM', name: 'Cubic Meter', symbol: 'CBM', decimalPlaces: 3, isBase: false },
  // Length / area
  { code: 'MM', name: 'Millimetre', symbol: 'mm', decimalPlaces: 3, isBase: false },
  { code: 'CM', name: 'Centimetre', symbol: 'cm', decimalPlaces: 3, isBase: false },
  { code: 'MTR', name: 'Meter', symbol: 'MTR', decimalPlaces: 3, isBase: true },
  { code: 'KM', name: 'Kilometre', symbol: 'KM', decimalPlaces: 3, isBase: false },
  { code: 'IN', name: 'Inch', symbol: 'in', decimalPlaces: 3, isBase: false },
  { code: 'FT', name: 'Foot', symbol: 'ft', decimalPlaces: 3, isBase: false },
  { code: 'YD', name: 'Yard', symbol: 'yd', decimalPlaces: 3, isBase: false },
  { code: 'SQM', name: 'Square Meter', symbol: 'SqM', decimalPlaces: 3, isBase: false },
  { code: 'SQFT', name: 'Square Foot', symbol: 'SqFt', decimalPlaces: 3, isBase: false },
  // Time / service
  { code: 'HR', name: 'Hour', symbol: 'Hr', decimalPlaces: 2, isBase: false },
  { code: 'DAY', name: 'Day', symbol: 'Day', decimalPlaces: 0, isBase: false },
  { code: 'WK', name: 'Week', symbol: 'Wk', decimalPlaces: 0, isBase: false },
  { code: 'MO', name: 'Month', symbol: 'Mo', decimalPlaces: 0, isBase: false },
  // Pharma / retail common
  { code: 'STRIP', name: 'Strip', symbol: 'Strip', decimalPlaces: 0, isBase: false },
  { code: 'TAB', name: 'Tablet', symbol: 'Tab', decimalPlaces: 0, isBase: false },
  { code: 'CAP', name: 'Capsule', symbol: 'Cap', decimalPlaces: 0, isBase: false },
  { code: 'VIAL', name: 'Vial', symbol: 'Vial', decimalPlaces: 0, isBase: false },
  { code: 'AMP', name: 'Ampoule', symbol: 'Amp', decimalPlaces: 0, isBase: false },
];

const DEFAULT_CONVERSIONS = [
  ['BOX', 'PCS', 100],
  ['CTN', 'PCS', 24],
  ['CASE', 'PCS', 12],
  ['DOZ', 'PCS', 12],
  ['GROSS', 'PCS', 144],
  ['PAIR', 'PCS', 2],
  ['SET', 'PCS', 1],
  ['PACK', 'PCS', 10],
  ['PKT', 'PCS', 10],
  ['BAG', 'PCS', 50],
  ['PLT', 'CTN', 40],
  ['STRIP', 'TAB', 10],
  ['TON', 'KG', 1000],
  ['KG', 'G', 1000],
  ['G', 'KG', 0.001],
  ['G', 'MG', 1000],
  ['LTR', 'ML', 1000],
  ['ML', 'LTR', 0.001],
  ['GAL', 'LTR', 3.785],
  ['DRM', 'LTR', 200],
  ['BARREL', 'LTR', 159],
  ['MTR', 'CM', 100],
  ['MTR', 'MM', 1000],
  ['CM', 'MM', 10],
  ['KM', 'MTR', 1000],
  ['FT', 'IN', 12],
  ['YD', 'FT', 3],
  ['SQM', 'SQFT', 10.764],
];

function picklistName(uom) {
  return String(uom.symbol || uom.name || uom.code || '')
    .trim()
    .slice(0, 100);
}

function normalizeCode(value, fallback = 'UOM') {
  const cleaned = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 20);
  return cleaned || fallback;
}

async function resolveSettingCreatorId(companyId, preferred) {
  if (preferred && preferred !== 'SYSTEM') {
    const user = await prisma.user.findUnique({
      where: { id: preferred },
      select: { id: true },
    });
    if (user) return user.id;
  }
  const membership = await prisma.companyMembership.findFirst({
    where: { companyId, isActive: true },
    select: { userId: true },
    orderBy: { createdAt: 'asc' },
  });
  if (membership?.userId) return membership.userId;
  const companyUser = await prisma.user.findFirst({
    where: { companyId, isActive: true },
    select: { id: true },
  });
  return companyUser?.id || null;
}

async function syncStockUnitSettings(companyId, createdBy = 'SYSTEM') {
  if (!companyId) return;
  const creatorId = await resolveSettingCreatorId(companyId, createdBy);
  if (!creatorId) {
    console.warn('[uomService] syncStockUnitSettings: no user to attribute settings');
    return;
  }

  const uoms = await prisma.unitOfMeasure.findMany({
    where: { companyId, isActive: true },
    orderBy: [{ isBase: 'desc' }, { code: 'asc' }],
  });

  const existing = await prisma.setting.findMany({
    where: { companyId, category: 'stockUnit', isActive: true },
    select: { id: true, name: true },
  });
  const byName = new Map(existing.map((s) => [String(s.name).toLowerCase(), s]));

  let order = 10;
  for (const uom of uoms) {
    const name = picklistName(uom);
    if (!name) continue;
    const key = name.toLowerCase();
    if (byName.has(key)) continue;
    try {
      await prisma.setting.create({
        data: {
          id: randomUUID(),
          category: 'stockUnit',
          name,
          metadata: {
            uomId: uom.id,
            code: uom.code,
            symbol: uom.symbol || null,
          },
          isDefault: uom.code === 'PCS',
          displayOrder: order,
          isActive: true,
          createdBy: creatorId,
          companyId,
        },
      });
      byName.set(key, { id: 'new', name });
    } catch (err) {
      // Unique race / duplicate name — ignore
      if (err?.code !== 'P2002') {
        console.warn('[uomService] syncStockUnitSettings:', err.message);
      }
    }
    order += 10;
  }
}

async function ensureDefaultUoms(companyId, opts = {}) {
  if (!companyId) return;
  const createdBy = opts.createdBy || 'SYSTEM';
  const now = new Date();

  const existing = await prisma.unitOfMeasure.findMany({
    where: { companyId },
    select: { code: true },
  });
  const have = new Set(existing.map((u) => String(u.code).toUpperCase()));
  const missing = DEFAULT_UOMS.filter((u) => !have.has(u.code));

  if (missing.length > 0) {
    await prisma.unitOfMeasure.createMany({
      data: missing.map((u) => ({
        id: randomUUID(),
        companyId,
        code: u.code,
        name: u.name,
        symbol: u.symbol,
        isBase: u.isBase,
        decimalPlaces: u.decimalPlaces,
        isActive: true,
        updatedAt: now,
      })),
      skipDuplicates: true,
    });
  }

  const byCode = Object.fromEntries(
    (await prisma.unitOfMeasure.findMany({ where: { companyId } })).map((u) => [
      u.code.toUpperCase(),
      u,
    ])
  );

  for (const [from, to, factor] of DEFAULT_CONVERSIONS) {
    if (!byCode[from] || !byCode[to]) continue;
    await prisma.uomConversion.upsert({
      where: {
        companyId_fromUomId_toUomId: {
          companyId,
          fromUomId: byCode[from].id,
          toUomId: byCode[to].id,
        },
      },
      create: {
        id: randomUUID(),
        companyId,
        fromUomId: byCode[from].id,
        toUomId: byCode[to].id,
        conversionFactor: factor,
        updatedAt: now,
      },
      update: { conversionFactor: factor, isActive: true },
    });
  }

  await syncStockUnitSettings(companyId, createdBy);
}

async function findUomByCode(companyId, code) {
  if (!code) return null;
  const normalized = String(code).trim().toUpperCase();
  if (!normalized) return null;
  await ensureDefaultUoms(companyId);
  return prisma.unitOfMeasure.findFirst({
    where: {
      companyId,
      isActive: true,
      OR: [
        { code: { equals: normalized, mode: 'insensitive' } },
        { name: { equals: String(code).trim(), mode: 'insensitive' } },
        { symbol: { equals: String(code).trim(), mode: 'insensitive' } },
      ],
    },
  });
}

async function ensureUom(companyId, code, name) {
  const existing = await findUomByCode(companyId, code);
  if (existing) {
    await syncStockUnitSettings(companyId);
    return existing;
  }
  const c = normalizeCode(code || name, 'PCS');
  const created = await prisma.unitOfMeasure.create({
    data: {
      id: randomUUID(),
      companyId,
      code: c,
      name: name || c,
      symbol: name || c,
      isBase: false,
      isActive: true,
      updatedAt: new Date(),
    },
  });
  await syncStockUnitSettings(companyId);
  return created;
}

async function createUom(companyId, payload = {}, createdBy = 'SYSTEM') {
  if (!companyId) {
    throw Object.assign(new Error('Company is required'), { statusCode: 400 });
  }
  await ensureDefaultUoms(companyId, { createdBy });

  const code = normalizeCode(payload.code || payload.symbol || payload.name);
  const name = String(payload.name || payload.symbol || code).trim().slice(0, 100);
  const symbol = String(payload.symbol || name || code).trim().slice(0, 40) || null;
  const decimalPlaces = Math.max(0, Math.min(6, parseInt(payload.decimalPlaces, 10) || 0));
  const isBase = Boolean(payload.isBase);

  if (!code || !name) {
    throw Object.assign(new Error('Unit code and name are required'), { statusCode: 400 });
  }

  const existing = await prisma.unitOfMeasure.findFirst({
    where: {
      companyId,
      OR: [
        { code: { equals: code, mode: 'insensitive' } },
        { name: { equals: name, mode: 'insensitive' } },
        ...(symbol
          ? [{ symbol: { equals: symbol, mode: 'insensitive' } }]
          : []),
      ],
    },
  });
  if (existing) {
    if (!existing.isActive) {
      const reactivated = await prisma.unitOfMeasure.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          name,
          symbol,
          decimalPlaces,
          isBase,
        },
      });
      await syncStockUnitSettings(companyId, createdBy);
      return reactivated;
    }
    throw Object.assign(new Error('A unit with this code or name already exists'), {
      statusCode: 400,
    });
  }

  const created = await prisma.unitOfMeasure.create({
    data: {
      id: randomUUID(),
      companyId,
      code,
      name,
      symbol,
      isBase,
      decimalPlaces,
      isActive: true,
      updatedAt: new Date(),
    },
  });
  await syncStockUnitSettings(companyId, createdBy);
  return created;
}

async function updateUom(companyId, id, payload = {}, updatedBy = 'SYSTEM') {
  const existing = await prisma.unitOfMeasure.findFirst({
    where: { id, companyId },
  });
  if (!existing) {
    throw Object.assign(new Error('Unit not found'), { statusCode: 404 });
  }

  const data = {};
  if (payload.name != null) data.name = String(payload.name).trim().slice(0, 100);
  if (payload.symbol != null) data.symbol = String(payload.symbol).trim().slice(0, 40) || null;
  if (payload.decimalPlaces != null) {
    data.decimalPlaces = Math.max(0, Math.min(6, parseInt(payload.decimalPlaces, 10) || 0));
  }
  if (payload.isBase != null) data.isBase = Boolean(payload.isBase);
  if (payload.isActive != null) data.isActive = Boolean(payload.isActive);
  if (payload.code != null) {
    data.code = normalizeCode(payload.code, existing.code);
  }

  const updated = await prisma.unitOfMeasure.update({
    where: { id },
    data,
  });
  await syncStockUnitSettings(companyId, updatedBy);
  return updated;
}

async function deactivateUom(companyId, id) {
  const existing = await prisma.unitOfMeasure.findFirst({
    where: { id, companyId },
  });
  if (!existing) {
    throw Object.assign(new Error('Unit not found'), { statusCode: 404 });
  }
  if (existing.code === 'PCS') {
    throw Object.assign(new Error('Cannot deactivate the default Pieces unit'), {
      statusCode: 400,
    });
  }
  return prisma.unitOfMeasure.update({
    where: { id },
    data: { isActive: false },
  });
}

/**
 * Convert quantity from `fromCode` into `toCode` (usually base UOM).
 * Direct conversion, or via identity if same.
 */
async function convertQuantity(companyId, qty, fromCode, toCode, precision = 6) {
  const q = toNumber(qty);
  if (!fromCode || !toCode || String(fromCode).toUpperCase() === String(toCode).toUpperCase()) {
    return roundTo(q, precision);
  }
  const from = await findUomByCode(companyId, fromCode);
  const to = await findUomByCode(companyId, toCode);
  if (!from || !to) return roundTo(q, precision);

  if (from.id === to.id) return roundTo(q, precision);

  const direct = await prisma.uomConversion.findFirst({
    where: {
      companyId,
      fromUomId: from.id,
      toUomId: to.id,
      isActive: true,
    },
  });
  if (direct) return roundTo(q * toNumber(direct.conversionFactor, 1), precision);

  const inverse = await prisma.uomConversion.findFirst({
    where: {
      companyId,
      fromUomId: to.id,
      toUomId: from.id,
      isActive: true,
    },
  });
  if (inverse && toNumber(inverse.conversionFactor) !== 0) {
    return roundTo(q / toNumber(inverse.conversionFactor), precision);
  }
  return roundTo(q, precision);
}

async function listUoms(companyId) {
  await ensureDefaultUoms(companyId);
  return prisma.unitOfMeasure.findMany({
    where: { companyId, isActive: true },
    orderBy: [{ isBase: 'desc' }, { code: 'asc' }],
  });
}

async function listConversions(companyId) {
  await ensureDefaultUoms(companyId);
  return prisma.uomConversion.findMany({
    where: { companyId, isActive: true },
    include: {
      fromUom: true,
      toUom: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

module.exports = {
  DEFAULT_UOMS,
  ensureDefaultUoms,
  syncStockUnitSettings,
  findUomByCode,
  ensureUom,
  createUom,
  updateUom,
  deactivateUom,
  convertQuantity,
  listUoms,
  listConversions,
};
