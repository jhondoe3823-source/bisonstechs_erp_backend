-- Run against Railway Postgres if migrate deploy is stuck / no Query UI needed when boot healer runs.
-- Idempotent warehouse schema heal.

ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "main_image" TEXT;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "track_inventory" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "opening_stock_posted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "item_type" TEXT NOT NULL DEFAULT 'READY_ITEM';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "show_in_pos" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "textile_item_class" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "purchase_unit_name" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "purchase_conversion_factor" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sales_unit_name" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sales_conversion_factor" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "allow_fractional_qty" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "qr_code" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "average_cost" DOUBLE PRECISION;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "last_purchase_price" DOUBLE PRECISION;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "last_purchase_date" TIMESTAMP(3);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "standard_cost" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "products_item_type_idx" ON "products"("item_type");
CREATE INDEX IF NOT EXISTS "products_show_in_pos_idx" ON "products"("show_in_pos");

ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "entered_quantity" DOUBLE PRECISION;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "conversion_factor" DOUBLE PRECISION;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "product_unit_id" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "reversal_of_id" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "base_quantity" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "stock_movements_idempotency_key_idx"
  ON "stock_movements"("idempotency_key");

UPDATE "stock_movements"
SET "entered_quantity" = "quantity"
WHERE "entered_quantity" IS NULL AND "quantity" IS NOT NULL;

UPDATE "stock_movements"
SET "base_quantity" = COALESCE("base_quantity", "quantity")
WHERE "base_quantity" IS NULL AND "quantity" IS NOT NULL;

UPDATE "stock_movements"
SET "conversion_factor" = 1
WHERE "conversion_factor" IS NULL;

UPDATE "products"
SET "opening_stock_posted" = true
WHERE COALESCE("opening_stock", 0) > 0
   OR COALESCE("current_stock", 0) > 0;
