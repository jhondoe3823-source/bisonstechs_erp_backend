-- Settings → Sales Agents (company toggles + monthly commission slabs)
CREATE TABLE IF NOT EXISTS "company_sales_agent_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "enable_sales_agents" BOOLEAN NOT NULL DEFAULT true,
    "track_commission" BOOLEAN NOT NULL DEFAULT true,
    "agent_required" BOOLEAN NOT NULL DEFAULT false,
    "custom_commission_slabs" BOOLEAN NOT NULL DEFAULT false,
    "commission_slabs" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_sales_agent_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_sales_agent_settings_company_id_key"
  ON "company_sales_agent_settings"("company_id");

DO $$ BEGIN
  ALTER TABLE "company_sales_agent_settings"
    ADD CONSTRAINT "company_sales_agent_settings_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Per-agent commission type: flat | slab
ALTER TABLE "salespersons"
  ADD COLUMN IF NOT EXISTS "commission_type" TEXT NOT NULL DEFAULT 'flat';

-- Invoice commission snapshot
ALTER TABLE "sales_invoices"
  ADD COLUMN IF NOT EXISTS "commission_percent" DOUBLE PRECISION DEFAULT 0;

ALTER TABLE "sales_invoices"
  ADD COLUMN IF NOT EXISTS "commission_amount" DOUBLE PRECISION DEFAULT 0;

-- POS sale agent + commission snapshot
ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "sales_person" TEXT;
ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "sales_person_id" TEXT;
ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "commission_percent" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "commission_amount" DOUBLE PRECISION DEFAULT 0;

CREATE INDEX IF NOT EXISTS "pos_sales_sales_person_id_idx" ON "pos_sales"("sales_person_id");

DO $$ BEGIN
  ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_sales_person_id_fkey"
    FOREIGN KEY ("sales_person_id") REFERENCES "salespersons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
