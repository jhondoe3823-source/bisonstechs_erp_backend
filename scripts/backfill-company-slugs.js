'use strict';

/**
 * One-time: assign unique slugs to companies that don't have one yet.
 * Usage: node scripts/backfill-company-slugs.js
 */
const prisma = require('../prisma/client');
const { allocateUniqueCompanySlug } = require('../utils/companySlug');

async function main() {
  const rows = await prisma.company.findMany({
    where: { OR: [{ slug: null }, { slug: '' }] },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${rows.length} companies without slug`);
  let ok = 0;
  for (const row of rows) {
    const slug = await allocateUniqueCompanySlug(row.name || `company-${row.id.slice(0, 8)}`);
    await prisma.company.update({
      where: { id: row.id },
      data: { slug },
    });
    ok += 1;
    console.log(`  ${row.name} → ${slug}`);
  }
  console.log(`Done. Updated ${ok} companies.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
