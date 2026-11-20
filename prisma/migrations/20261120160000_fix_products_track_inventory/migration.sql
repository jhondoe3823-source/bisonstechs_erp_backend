-- Follow-up Railway heal: products.track_inventory (+ related multi-unit flags)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "track_inventory" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "opening_stock_posted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "purchase_unit_name" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "purchase_conversion_factor" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sales_unit_name" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sales_conversion_factor" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "allow_fractional_qty" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "textile_item_class" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "average_cost" DOUBLE PRECISION;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "last_purchase_price" DOUBLE PRECISION;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "last_purchase_date" TIMESTAMP(3);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "standard_cost" DOUBLE PRECISION;

UPDATE "products"
SET "opening_stock_posted" = true
WHERE COALESCE("opening_stock", 0) > 0
   OR COALESCE("current_stock", 0) > 0;
