CREATE TABLE "paid_campaign_provider_paused_confirmations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_campaign_id" TEXT NOT NULL,
    "verification_status" TEXT NOT NULL DEFAULT 'user_asserted_unverified',
    "snapshot_version" INTEGER NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "confirmed_by" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paid_campaign_provider_paused_confirmations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "paid_provider_confirmations_platform_check" CHECK ("platform" IN ('google_ads', 'meta_ads', 'tiktok_ads')),
    CONSTRAINT "paid_provider_confirmations_provider_id_check" CHECK ("provider_campaign_id" ~ '^[0-9]{1,32}$'),
    CONSTRAINT "paid_provider_confirmations_verification_check" CHECK ("verification_status" = 'user_asserted_unverified'),
    CONSTRAINT "paid_provider_confirmations_version_check" CHECK ("snapshot_version" >= 1),
    CONSTRAINT "paid_provider_confirmations_snapshot_hash_check" CHECK ("snapshot_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "paid_provider_confirmations_request_hash_check" CHECK ("request_hash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "paid_provider_confirmations_draft_workspace_key"
    ON "paid_campaign_provider_paused_confirmations"("draft_id", "workspace_id");
CREATE UNIQUE INDEX "paid_provider_confirmations_workspace_request_key"
    ON "paid_campaign_provider_paused_confirmations"("workspace_id", "request_id");
CREATE UNIQUE INDEX "paid_provider_confirmations_provider_identity_key"
    ON "paid_campaign_provider_paused_confirmations"("workspace_id", "platform", "account_id", "provider_campaign_id");
CREATE INDEX "paid_provider_confirmations_workspace_confirmed_idx"
    ON "paid_campaign_provider_paused_confirmations"("workspace_id", "confirmed_at");

ALTER TABLE "paid_campaign_provider_paused_confirmations"
    ADD CONSTRAINT "paid_campaign_provider_paused_confirmations_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "paid_campaign_provider_paused_confirmations"
    ADD CONSTRAINT "paid_provider_confirmations_draft_tenant_fkey"
    FOREIGN KEY ("draft_id", "workspace_id") REFERENCES "paid_campaign_drafts"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
