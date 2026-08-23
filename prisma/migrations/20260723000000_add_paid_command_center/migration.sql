-- Sprint 9: account-aware paid reporting, durable sync outcomes, and safe stale reconciliation.
-- Legacy rows are mapped only when exactly one connection exists for the
-- workspace/platform pair. Ambiguous rows remain nullable and are excluded by
-- the paid dashboard until a provider resync writes canonical identities.

ALTER TABLE "connections"
  ADD COLUMN IF NOT EXISTS "currency" TEXT,
  ADD COLUMN IF NOT EXISTS "timezone" TEXT,
  ADD COLUMN IF NOT EXISTS "last_sync_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_successful_sync_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_error_code" TEXT,
  ADD COLUMN IF NOT EXISTS "last_error_message" TEXT;

ALTER TABLE "metric_facts"
  ADD COLUMN IF NOT EXISTS "connection_id" TEXT,
  ADD COLUMN IF NOT EXISTS "campaign_external_id" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "campaign_name" TEXT,
  ADD COLUMN IF NOT EXISTS "currency" TEXT,
  ADD COLUMN IF NOT EXISTS "last_seen_attempt_id" TEXT,
  ADD COLUMN IF NOT EXISTS "stale_at" TIMESTAMP(3);

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "connection_id" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_external_id" TEXT,
  ADD COLUMN IF NOT EXISTS "last_seen_attempt_id" TEXT,
  ADD COLUMN IF NOT EXISTS "stale_at" TIMESTAMP(3);

ALTER TABLE "ads"
  ADD COLUMN IF NOT EXISTS "connection_id" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_external_id" TEXT,
  ADD COLUMN IF NOT EXISTS "currency" TEXT,
  ADD COLUMN IF NOT EXISTS "metrics_from" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "metrics_to" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_seen_attempt_id" TEXT,
  ADD COLUMN IF NOT EXISTS "stale_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "sync_attempts" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "trigger" TEXT NOT NULL DEFAULT 'manual',
  "status" TEXT NOT NULL DEFAULT 'running',
  "requested_from" TIMESTAMP(3) NOT NULL,
  "requested_to" TIMESTAMP(3) NOT NULL,
  "observed_from" TIMESTAMP(3),
  "observed_to" TIMESTAMP(3),
  "currency" TEXT,
  "timezone" TEXT,
  "metrics_status" TEXT NOT NULL DEFAULT 'pending',
  "campaigns_status" TEXT NOT NULL DEFAULT 'pending',
  "ads_status" TEXT NOT NULL DEFAULT 'pending',
  "phase_details" JSONB,
  "error_code" TEXT,
  "error_message" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sync_attempts_pkey" PRIMARY KEY ("id")
);

-- Resolve one and only one account for each legacy workspace/platform grain.
WITH unambiguous AS (
  SELECT "workspace_id", "platform", MIN("id") AS "connection_id"
  FROM "connections"
  GROUP BY "workspace_id", "platform"
  HAVING COUNT(*) = 1
), resolved_metrics AS (
  SELECT
    m."id" AS "metric_id",
    u."connection_id",
    CASE WHEN m."campaign" = '' THEN '' ELSE MIN(c."external_id") END AS "campaign_external_id"
  FROM "metric_facts" m
  JOIN unambiguous u
    ON u."workspace_id" = m."workspace_id"
   AND u."platform" = m."platform"
  LEFT JOIN "campaigns" c
    ON c."workspace_id" = m."workspace_id"
   AND c."platform" = m."platform"
   AND (c."external_id" = m."campaign" OR c."name" = m."campaign")
  WHERE m."connection_id" IS NULL
  GROUP BY m."id", u."connection_id", m."campaign"
  HAVING m."campaign" = '' OR COUNT(DISTINCT c."external_id") = 1
)
UPDATE "metric_facts" AS m
SET "connection_id" = r."connection_id",
    "campaign_name" = NULLIF(m."campaign", ''),
    "campaign_external_id" = r."campaign_external_id",
    "campaign" = r."connection_id" || ':' || r."campaign_external_id"
FROM resolved_metrics r
WHERE m."id" = r."metric_id";

WITH unambiguous AS (
  SELECT "workspace_id", "platform", MIN("id") AS "connection_id"
  FROM "connections"
  GROUP BY "workspace_id", "platform"
  HAVING COUNT(*) = 1
)
UPDATE "campaigns" AS c
SET "connection_id" = u."connection_id",
    "provider_external_id" = c."external_id",
    "external_id" = u."connection_id" || ':' || c."external_id"
FROM unambiguous u
WHERE c."connection_id" IS NULL
  AND u."workspace_id" = c."workspace_id"
  AND u."platform" = c."platform";

WITH unambiguous AS (
  SELECT "workspace_id", "platform", MIN("id") AS "connection_id"
  FROM "connections"
  GROUP BY "workspace_id", "platform"
  HAVING COUNT(*) = 1
)
UPDATE "ads" AS a
SET "connection_id" = u."connection_id",
    "provider_external_id" = a."external_id",
    "external_id" = u."connection_id" || ':' || a."external_id"
FROM unambiguous u
WHERE a."connection_id" IS NULL
  AND u."workspace_id" = a."workspace_id"
  AND u."platform" = a."platform";

UPDATE "metric_facts"
SET "stale_at" = COALESCE("stale_at", CURRENT_TIMESTAMP)
WHERE "connection_id" IS NULL
  AND "platform" IN ('google_ads', 'meta_ads', 'tiktok_ads');

UPDATE "campaigns"
SET "provider_external_id" = COALESCE("provider_external_id", "external_id"),
    "stale_at" = COALESCE("stale_at", CURRENT_TIMESTAMP)
WHERE "connection_id" IS NULL;

UPDATE "ads"
SET "provider_external_id" = COALESCE("provider_external_id", "external_id"),
    "stale_at" = COALESCE("stale_at", CURRENT_TIMESTAMP)
WHERE "connection_id" IS NULL;

CREATE INDEX IF NOT EXISTS "metric_facts_workspace_id_connection_id_date_idx"
  ON "metric_facts"("workspace_id", "connection_id", "date");
CREATE INDEX IF NOT EXISTS "metric_facts_connection_id_stale_at_idx"
  ON "metric_facts"("connection_id", "stale_at");
CREATE UNIQUE INDEX IF NOT EXISTS "metric_facts_connection_id_date_campaign_external_id_metric_key"
  ON "metric_facts"("connection_id", "date", "campaign_external_id", "metric");

CREATE INDEX IF NOT EXISTS "campaigns_workspace_id_connection_id_stale_at_idx"
  ON "campaigns"("workspace_id", "connection_id", "stale_at");
CREATE UNIQUE INDEX IF NOT EXISTS "campaigns_connection_id_provider_external_id_key"
  ON "campaigns"("connection_id", "provider_external_id");

CREATE INDEX IF NOT EXISTS "ads_workspace_id_connection_id_stale_at_idx"
  ON "ads"("workspace_id", "connection_id", "stale_at");
CREATE UNIQUE INDEX IF NOT EXISTS "ads_connection_id_provider_external_id_key"
  ON "ads"("connection_id", "provider_external_id");

CREATE INDEX IF NOT EXISTS "sync_attempts_workspace_id_started_at_idx"
  ON "sync_attempts"("workspace_id", "started_at");
CREATE INDEX IF NOT EXISTS "sync_attempts_connection_id_started_at_idx"
  ON "sync_attempts"("connection_id", "started_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metric_facts_connection_id_fkey') THEN
    ALTER TABLE "metric_facts" ADD CONSTRAINT "metric_facts_connection_id_fkey"
      FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_connection_id_fkey') THEN
    ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_connection_id_fkey"
      FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ads_connection_id_fkey') THEN
    ALTER TABLE "ads" ADD CONSTRAINT "ads_connection_id_fkey"
      FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_attempts_workspace_id_fkey') THEN
    ALTER TABLE "sync_attempts" ADD CONSTRAINT "sync_attempts_workspace_id_fkey"
      FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_attempts_connection_id_fkey') THEN
    ALTER TABLE "sync_attempts" ADD CONSTRAINT "sync_attempts_connection_id_fkey"
      FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
