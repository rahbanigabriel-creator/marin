-- Campaign and Ad were added to schema.prisma after the initial migration and
-- already exist in the production database. This idempotent baseline makes a
-- fresh database reproducible without failing when production applies it.

CREATE TABLE IF NOT EXISTS "campaigns" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "objective" TEXT,
    "budget" DOUBLE PRECISION,
    "budget_type" TEXT,
    "currency" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ads" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "campaign_external_id" TEXT,
    "campaign_name" TEXT,
    "adset_name" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "creative_type" TEXT,
    "thumbnail_url" TEXT,
    "title" TEXT,
    "body" TEXT,
    "call_to_action" TEXT,
    "link_url" TEXT,
    "spend" DOUBLE PRECISION,
    "impressions" DOUBLE PRECISION,
    "clicks" DOUBLE PRECISION,
    "conversions" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "campaigns_workspace_id_platform_idx" ON "campaigns"("workspace_id", "platform");
CREATE UNIQUE INDEX IF NOT EXISTS "campaigns_workspace_id_platform_external_id_key" ON "campaigns"("workspace_id", "platform", "external_id");
CREATE INDEX IF NOT EXISTS "ads_workspace_id_platform_campaign_external_id_idx" ON "ads"("workspace_id", "platform", "campaign_external_id");
CREATE INDEX IF NOT EXISTS "ads_workspace_id_campaign_name_idx" ON "ads"("workspace_id", "campaign_name");
CREATE UNIQUE INDEX IF NOT EXISTS "ads_workspace_id_platform_external_id_key" ON "ads"("workspace_id", "platform", "external_id");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_workspace_id_fkey') THEN
        ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_fkey"
            FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ads_workspace_id_fkey') THEN
        ALTER TABLE "ads" ADD CONSTRAINT "ads_workspace_id_fkey"
            FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

