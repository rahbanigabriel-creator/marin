CREATE TABLE "paid_agent_policies" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "account_name" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "threshold" DOUBLE PRECISION NOT NULL,
  "window_days" INTEGER NOT NULL,
  "min_spend" DOUBLE PRECISION NOT NULL,
  "min_conversions" INTEGER NOT NULL,
  "cadence_hours" INTEGER NOT NULL,
  "policy_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_by" TEXT NOT NULL,
  "last_check_at" TIMESTAMP(3),
  "next_check_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "paid_agent_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "paid_agent_policies_valid_goal" CHECK ("goal" IN ('min_roas', 'max_cpa', 'max_spend')),
  CONSTRAINT "paid_agent_policies_valid_platform" CHECK ("platform" IN ('google_ads', 'meta_ads')),
  CONSTRAINT "paid_agent_policies_valid_status" CHECK ("status" IN ('active', 'paused')),
  CONSTRAINT "paid_agent_policies_valid_limits" CHECK (
    "threshold" > 0 AND "threshold" <= 1000000000 AND "min_spend" >= 1 AND "min_spend" <= 1000000000
    AND "min_conversions" BETWEEN 1 AND 1000000 AND "window_days" IN (1, 7, 14, 30)
    AND "cadence_hours" IN (6, 12, 24) AND "version" > 0
  )
);

CREATE TABLE "paid_agent_checks" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "policy_id" TEXT NOT NULL,
  "policy_version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "reason" TEXT NOT NULL,
  "result" JSONB,
  "sync_attempt_id" TEXT,
  "review_status" TEXT NOT NULL DEFAULT 'none',
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "review_expires_at" TIMESTAMP(3),
  "due_at" TIMESTAMP(3) NOT NULL,
  "deadline_at" TIMESTAMP(3) NOT NULL,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "paid_agent_checks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "paid_agent_checks_valid_status" CHECK ("status" IN ('queued', 'running', 'healthy', 'needs_review', 'blocked', 'cancelled')),
  CONSTRAINT "paid_agent_checks_valid_review" CHECK ("review_status" IN ('none', 'pending', 'acknowledged', 'dismissed', 'expired', 'invalidated'))
);

CREATE UNIQUE INDEX "paid_agent_policies_id_workspace_id_key" ON "paid_agent_policies"("id", "workspace_id");
CREATE UNIQUE INDEX "paid_agent_policies_workspace_id_policy_key_key" ON "paid_agent_policies"("workspace_id", "policy_key");
CREATE INDEX "paid_agent_policies_status_next_check_at_idx" ON "paid_agent_policies"("status", "next_check_at");
CREATE UNIQUE INDEX "paid_agent_checks_policy_id_policy_version_due_at_key" ON "paid_agent_checks"("policy_id", "policy_version", "due_at");
CREATE INDEX "paid_agent_checks_workspace_id_policy_id_created_at_idx" ON "paid_agent_checks"("workspace_id", "policy_id", "created_at");
CREATE INDEX "paid_agent_checks_status_deadline_at_idx" ON "paid_agent_checks"("status", "deadline_at");
CREATE INDEX "paid_agent_checks_review_status_review_expires_at_idx" ON "paid_agent_checks"("review_status", "review_expires_at");
ALTER TABLE "paid_agent_policies" ADD CONSTRAINT "paid_agent_policies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "paid_agent_checks" ADD CONSTRAINT "paid_agent_checks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "paid_agent_checks" ADD CONSTRAINT "paid_agent_checks_policy_id_workspace_id_fkey" FOREIGN KEY ("policy_id", "workspace_id") REFERENCES "paid_agent_policies"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Extend the ledger's operation allowlist without changing existing operation
-- names, request validation, or workspace/operation/request idempotency scope.
ALTER TABLE "manual_creation_requests"
  DROP CONSTRAINT "manual_creation_requests_operation_check",
  ADD CONSTRAINT "manual_creation_requests_operation_check"
    CHECK ("operation" IN (
      'content_plan_create',
      'content_post_create',
      'content_item_create',
      'content_variant_create',
      'publication_create',
      'conversation_create',
      'paid_agents'
    ));
