'use strict';

const prisma = require('../prisma/client');

/** Reserved first-labels that must never be company tenants. */
const RESERVED_SLUGS = new Set([
  'app',
  'www',
  'api',
  'admin',
  'mail',
  'ftp',
  'cdn',
  'static',
  'assets',
  'staging',
  'dev',
  'test',
  'demo',
  'help',
  'support',
  'status',
  'docs',
  'blog',
  'portal',
  'login',
  'register',
  'dashboard',
  'billing',
  'pay',
  'webhook',
  'webhooks',
  'localhost',
  'bisonstechs',
]);

/**
 * Normalize a company name / proposed slug into a URL-safe subdomain label.
 * @param {string} input
 * @returns {string}
 */
function slugifyCompanyName(input) {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48)
    .replace(/^-+|-+$/g, '');
}

function isReservedSlug(slug) {
  return RESERVED_SLUGS.has(String(slug || '').toLowerCase());
}

function isValidSlugFormat(slug) {
  const s = String(slug || '');
  if (s.length < 2 || s.length > 48) return false;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) return false;
  if (isReservedSlug(s)) return false;
  return true;
}

/**
 * Allocate a unique slug for a new company.
 * @param {string} preferredNameOrSlug
 * @param {{ excludeCompanyId?: string }} [opts]
 * @returns {Promise<string>}
 */
async function allocateUniqueCompanySlug(preferredNameOrSlug, opts = {}) {
  let base = slugifyCompanyName(preferredNameOrSlug);
  if (!base || base.length < 2) base = 'company';
  if (isReservedSlug(base)) base = `${base}-co`;

  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`.slice(0, 48);
    if (!isValidSlugFormat(candidate) && i === 0) continue;
    const where = {
      slug: candidate,
      ...(opts.excludeCompanyId ? { NOT: { id: opts.excludeCompanyId } } : {}),
    };
    const existing = await prisma.company.findFirst({
      where,
      select: { id: true },
    });
    if (!existing) return candidate;
  }

  // Extremely unlikely fallback
  return `c-${Date.now().toString(36)}`;
}

/**
 * Extract tenant slug from Host header.
 * acme.bisonstechs.com → acme
 * acme.localhost:3000 → acme
 * app.bisonstechs.com → null
 * @param {string} host
 * @param {string} [rootDomain] e.g. bisonstechs.com
 * @returns {string|null}
 */
function extractTenantSlugFromHost(host, rootDomain) {
  if (!host) return null;
  const hostname = String(host).split(':')[0].toLowerCase().trim();
  if (!hostname || hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return null;
  }

  const root = String(
    rootDomain || process.env.TENANT_ROOT_DOMAIN || process.env.COOKIE_DOMAIN || 'bisonstechs.com'
  )
    .replace(/^\./, '')
    .toLowerCase();

  // Local: acme.localhost
  if (hostname.endsWith('.localhost')) {
    const label = hostname.slice(0, -'.localhost'.length);
    if (!label || label.includes('.')) return null;
    if (isReservedSlug(label) || !isValidSlugFormat(label)) return null;
    return label;
  }

  if (!hostname.endsWith(`.${root}`) && hostname !== root) return null;
  if (hostname === root || hostname === `www.${root}` || hostname === `app.${root}`) {
    return null;
  }

  const prefix = hostname.slice(0, -(`.${root}`.length));
  // Only single-label tenants for now (no nested.a.bisonstechs.com)
  if (!prefix || prefix.includes('.')) return null;
  if (isReservedSlug(prefix) || !isValidSlugFormat(prefix)) return null;
  return prefix;
}

async function findCompanyBySlug(slug) {
  const s = String(slug || '').toLowerCase().trim();
  if (!isValidSlugFormat(s)) return null;
  return prisma.company.findFirst({
    where: { slug: s, isActive: true },
    select: {
      id: true,
      name: true,
      slug: true,
      logo: true,
      isActive: true,
    },
  });
}

module.exports = {
  RESERVED_SLUGS,
  slugifyCompanyName,
  isReservedSlug,
  isValidSlugFormat,
  allocateUniqueCompanySlug,
  extractTenantSlugFromHost,
  findCompanyBySlug,
};
