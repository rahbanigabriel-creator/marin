-- Sprint 3: deterministic Free/Solo entitlements, period-bound integer usage,
-- and replay/order-safe Stripe subscription state.

ALTER TABLE "subscriptions"
  ADD COLUMN "stripe_price_id" TEXT,
  ADD COLUMN "billing_interval" TEXT,
  ADD COLUMN "current_period_start" TIMESTAMP(3),
  ADD COLUMN "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "last_stripe_event_at" TIMESTAMP(3);

-- Preserve one authoritative owner before making Stripe identities unique.
WITH ranked_customers AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "stripe_customer_id" ORDER BY "updated_at" DESC, "id" DESC
  ) AS row_number
  FROM "subscriptions"
  WHERE "stripe_customer_id" IS NOT NULL
)
UPDATE "subscriptions" AS subscription
SET "stripe_customer_id" = NULL
FROM ranked_customers AS ranked
WHERE subscription."id" = ranked."id" AND ranked.row_number > 1;

WITH ranked_subscriptions AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "stripe_sub_id" ORDER BY "updated_at" DESC, "id" DESC
  ) AS row_number
  FROM "subscriptions"
  WHERE "stripe_sub_id" IS NOT NULL
)
UPDATE "subscriptions" AS subscription
SET "stripe_sub_id" = NULL
FROM ranked_subscriptions AS ranked
WHERE subscription."id" = ranked."id" AND ranked.row_number > 1;

CREATE UNIQUE INDEX "subscriptions_stripe_customer_id_key"
  ON "subscriptions"("stripe_customer_id");
CREATE UNIQUE INDEX "subscriptions_stripe_sub_id_key"
  ON "subscriptions"("stripe_sub_id");

ALTER TABLE "usage_events"
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'committed',
  ADD COLUMN "period_start" TIMESTAMP(3),
  ADD COLUMN "period_end" TIMESTAMP(3),
  ADD COLUMN "reserved_at" TIMESTAMP(3),
  ADD COLUMN "committed_at" TIMESTAMP(3),
  ADD COLUMN "released_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3);

UPDATE "usage_events"
SET
  "credits" = ROUND("credits"),
  "idempotency_key" = 'legacy:' || "id",
  "period_start" = date_trunc('month', "created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
  "period_end" = (date_trunc('month', "created_at" AT TIME ZONE 'UTC') + INTERVAL '1 month') AT TIME ZONE 'UTC',
  "reserved_at" = "created_at",
  "committed_at" = "created_at",
  "updated_at" = "created_at";

ALTER TABLE "usage_events"
  ALTER COLUMN "idempotency_key" SET DEFAULT ('rollback:' || md5(random()::text || clock_timestamp()::text || txid_current()::text)),
  ALTER COLUMN "idempotency_key" SET NOT NULL,
  ALTER COLUMN "period_start" SET DEFAULT date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  ALTER COLUMN "period_start" SET NOT NULL,
  ALTER COLUMN "period_end" SET DEFAULT (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '1 month'),
  ALTER COLUMN "period_end" SET NOT NULL,
  ALTER COLUMN "reserved_at" SET NOT NULL,
  ALTER COLUMN "reserved_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET NOT NULL;

CREATE UNIQUE INDEX "usage_events_workspace_id_idempotency_key_key"
  ON "usage_events"("workspace_id", "idempotency_key");
CREATE INDEX "usage_events_workspace_id_status_period_start_idx"
  ON "usage_events"("workspace_id", "status", "period_start");

CREATE TABLE "billing_events" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT,
  "stripe_event_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "stripe_created_at" TIMESTAMP(3) NOT NULL,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_events_stripe_event_id_key"
  ON "billing_events"("stripe_event_id");
CREATE INDEX "billing_events_workspace_id_processed_at_idx"
  ON "billing_events"("workspace_id", "processed_at");
CREATE INDEX "billing_events_type_stripe_created_at_idx"
  ON "billing_events"("type", "stripe_created_at");

ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
