CREATE TABLE "paid_campaign_drafts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT,
    "platform" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "snapshot" JSONB NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "ready_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paid_campaign_drafts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "paid_campaign_drafts_platform_check" CHECK ("platform" IN ('google_ads', 'meta_ads', 'tiktok_ads')),
    CONSTRAINT "paid_campaign_drafts_source_check" CHECK ("source" IN ('manual', 'ai')),
    CONSTRAINT "paid_campaign_drafts_state_check" CHECK ("state" IN ('draft', 'ready', 'creating_paused', 'provider_paused', 'activating', 'activation_requested', 'active', 'in_review', 'rejected', 'needs_reconciliation')),
    CONSTRAINT "paid_campaign_drafts_version_check" CHECK ("version" >= 1),
    CONSTRAINT "paid_campaign_drafts_hash_check" CHECK ("snapshot_hash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "paid_campaign_drafts_id_workspace_key"
    ON "paid_campaign_drafts"("id", "workspace_id");
CREATE INDEX "paid_campaign_drafts_workspace_updated_idx"
    ON "paid_campaign_drafts"("workspace_id", "updated_at");
CREATE INDEX "paid_campaign_drafts_state_idx"
    ON "paid_campaign_drafts"("workspace_id", "state", "updated_at");
CREATE INDEX "paid_campaign_drafts_connection_idx"
    ON "paid_campaign_drafts"("connection_id");

CREATE TABLE "paid_campaign_draft_mutations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "result_version" INTEGER NOT NULL,
    "result_state" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paid_campaign_draft_mutations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "paid_draft_mutations_kind_check" CHECK ("kind" IN ('create', 'update', 'mark_ready')),
    CONSTRAINT "paid_draft_mutations_version_check" CHECK ("result_version" >= 1),
    CONSTRAINT "paid_draft_mutations_hash_check" CHECK ("request_hash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "paid_draft_mutations_workspace_request_key"
    ON "paid_campaign_draft_mutations"("workspace_id", "request_id");
CREATE INDEX "paid_draft_mutations_draft_created_idx"
    ON "paid_campaign_draft_mutations"("draft_id", "created_at");

CREATE TABLE "paid_campaign_approvals" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "snapshot_version" INTEGER NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "approved_by" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paid_campaign_approvals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "paid_campaign_approvals_kind_check" CHECK ("kind" IN ('create_paused', 'activate')),
    CONSTRAINT "paid_campaign_approvals_platform_check" CHECK ("platform" IN ('google_ads', 'meta_ads', 'tiktok_ads')),
    CONSTRAINT "paid_campaign_approvals_version_check" CHECK ("snapshot_version" >= 1),
    CONSTRAINT "paid_campaign_approvals_snapshot_hash_check" CHECK ("snapshot_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "paid_campaign_approvals_request_hash_check" CHECK ("request_hash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "paid_campaign_approvals_id_workspace_key"
    ON "paid_campaign_approvals"("id", "workspace_id");
CREATE UNIQUE INDEX "paid_campaign_approvals_workspace_request_key"
    ON "paid_campaign_approvals"("workspace_id", "request_id");
CREATE INDEX "paid_campaign_approvals_draft_approved_idx"
    ON "paid_campaign_approvals"("draft_id", "approved_at");

CREATE TABLE "paid_campaign_operation_attempts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "approval_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "snapshot_version" INTEGER NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "capability_reason" TEXT NOT NULL,
    "provider_outcome" JSONB,
    "actor_id" TEXT NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paid_campaign_operation_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "paid_operation_attempts_operation_check" CHECK ("operation" IN ('create_paused', 'activate')),
    CONSTRAINT "paid_operation_attempts_status_check" CHECK ("status" IN ('assisted_handoff', 'succeeded', 'failed', 'needs_reconciliation')),
    CONSTRAINT "paid_operation_attempts_version_check" CHECK ("snapshot_version" >= 1),
    CONSTRAINT "paid_operation_attempts_snapshot_hash_check" CHECK ("snapshot_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "paid_operation_attempts_request_hash_check" CHECK ("request_hash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "paid_campaign_operation_attempts_approval_id_key"
    ON "paid_campaign_operation_attempts"("approval_id");
CREATE UNIQUE INDEX "paid_operation_attempts_workspace_request_key"
    ON "paid_campaign_operation_attempts"("workspace_id", "request_id");
CREATE UNIQUE INDEX "paid_operation_attempts_approval_workspace_key"
    ON "paid_campaign_operation_attempts"("approval_id", "workspace_id");
CREATE INDEX "paid_operation_attempts_draft_attempted_idx"
    ON "paid_campaign_operation_attempts"("draft_id", "attempted_at");
CREATE INDEX "paid_operation_attempts_workspace_attempted_idx"
    ON "paid_campaign_operation_attempts"("workspace_id", "attempted_at");

ALTER TABLE "paid_campaign_drafts"
    ADD CONSTRAINT "paid_campaign_drafts_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "paid_campaign_drafts"
    ADD CONSTRAINT "paid_campaign_drafts_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "paid_campaign_draft_mutations"
    ADD CONSTRAINT "paid_campaign_draft_mutations_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "paid_campaign_draft_mutations"
    ADD CONSTRAINT "paid_draft_mutations_draft_tenant_fkey"
    FOREIGN KEY ("draft_id", "workspace_id") REFERENCES "paid_campaign_drafts"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "paid_campaign_approvals"
    ADD CONSTRAINT "paid_campaign_approvals_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "paid_campaign_approvals"
    ADD CONSTRAINT "paid_approvals_draft_tenant_fkey"
    FOREIGN KEY ("draft_id", "workspace_id") REFERENCES "paid_campaign_drafts"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "paid_campaign_operation_attempts"
    ADD CONSTRAINT "paid_campaign_operation_attempts_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "paid_campaign_operation_attempts"
    ADD CONSTRAINT "paid_operation_attempts_draft_tenant_fkey"
    FOREIGN KEY ("draft_id", "workspace_id") REFERENCES "paid_campaign_drafts"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "paid_campaign_operation_attempts"
    ADD CONSTRAINT "paid_operation_attempts_approval_tenant_fkey"
    FOREIGN KEY ("approval_id", "workspace_id") REFERENCES "paid_campaign_approvals"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
