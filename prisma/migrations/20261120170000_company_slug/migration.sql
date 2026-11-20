-- Company tenant subdomain slug (acme.bisonstechs.com)
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "slug" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "companies_slug_key" ON "companies"("slug");
