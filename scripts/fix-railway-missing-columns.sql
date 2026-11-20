-- Run against Railway Postgres (Query / psql) if migrate deploy is stuck.
-- Same content as migration 20261120154500_fix_missing_warehouse_columns.

ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "main_image" TEXT;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "item_type" TEXT NOT NULL DEFAULT 'READY_ITEM';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "show_in_pos" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS "products_item_type_idx" ON "products"("item_type");
CREATE INDEX IF NOT EXISTS "products_show_in_pos_idx" ON "products"("show_in_pos");

ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "entered_quantity" DOUBLE PRECISION;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "conversion_factor" DOUBLE PRECISION;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "product_unit_id" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "reversal_of_id" TEXT;

CREATE INDEX IF NOT EXISTS "stock_movements_idempotency_key_idx"
  ON "stock_movements"("idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "stock_movements_company_id_idempotency_key_key"
  ON "stock_movements"("company_id", "idempotency_key");

UPDATE "stock_movements"
SET "entered_quantity" = "quantity"
WHERE "entered_quantity" IS NULL AND "quantity" IS NOT NULL;

UPDATE "stock_movements"
SET "base_quantity" = COALESCE("base_quantity", "quantity")
WHERE "base_quantity" IS NULL AND "quantity" IS NOT NULL;

UPDATE "stock_movements"
SET "conversion_factor" = 1
WHERE "conversion_factor" IS NULL;
