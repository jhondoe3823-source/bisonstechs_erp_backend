'use strict';

/**
 * Fail-open schema patch for production DBs where migrate history is stuck
 * but Prisma Client expects newer columns (P2022).
 *
 * Safe / idempotent — uses ADD COLUMN IF NOT EXISTS.
 */
const { PrismaClient } = require('@prisma/client');

const STATEMENTS = [
  `ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "main_image" TEXT`,
  `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "item_type" TEXT NOT NULL DEFAULT 'READY_ITEM'`,
  `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "show_in_pos" BOOLEAN NOT NULL DEFAULT true`,
  `CREATE INDEX IF NOT EXISTS "products_item_type_idx" ON "products"("item_type")`,
  `CREATE INDEX IF NOT EXISTS "products_show_in_pos_idx" ON "products"("show_in_pos")`,
  `ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "entered_quantity" DOUBLE PRECISION`,
  `ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "conversion_factor" DOUBLE PRECISION`,
  `ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "product_unit_id" TEXT`,
  `ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT`,
  `ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "reversal_of_id" TEXT`,
  `CREATE INDEX IF NOT EXISTS "stock_movements_idempotency_key_idx" ON "stock_movements"("idempotency_key")`,
  `UPDATE "stock_movements" SET "entered_quantity" = "quantity" WHERE "entered_quantity" IS NULL AND "quantity" IS NOT NULL`,
  `UPDATE "stock_movements" SET "conversion_factor" = 1 WHERE "conversion_factor" IS NULL`,
];

async function ensureCriticalColumns() {
  const prisma = new PrismaClient();
  try {
    for (const sql of STATEMENTS) {
      try {
        await prisma.$executeRawUnsafe(sql);
      } catch (err) {
        // Unique index may fail if duplicates exist — non-fatal for boot.
        console.warn(
          '[ensure-critical-columns] statement warning:',
          sql.slice(0, 80),
          '→',
          (err.message || '').slice(0, 200)
        );
      }
    }
    console.log('[ensure-critical-columns] OK');
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (require.main === module) {
  ensureCriticalColumns()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[ensure-critical-columns] FAILED:', err);
      process.exit(1);
    });
}

module.exports = { ensureCriticalColumns };
