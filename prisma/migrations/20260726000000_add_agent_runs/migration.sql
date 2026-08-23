-- Bounded, tenant-scoped agent workflow persistence. No raw model reasoning,
-- credentials, or provider request/response payloads are stored.
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "plan_key" TEXT NOT NULL,
    "target" JSONB,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "dispatch_status" TEXT NOT NULL DEFAULT 'pending',
    "dispatch_error_code" TEXT,
    "limits" JSONB NOT NULL,
    "steps_used" INTEGER NOT NULL DEFAULT 0,
    "tool_calls_used" INTEGER NOT NULL DEFAULT 0,
    "model_turns_used" INTEGER NOT NULL DEFAULT 0,
    "web_reads_used" INTEGER NOT NULL DEFAULT 0,
    "credits_used" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "deadline_at" TIMESTAMP(3) NOT NULL,
    "cancel_requested_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_run_steps" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL,
    "tool_name" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "approval_binding" JSONB,
    "output_object_type" TEXT,
    "output_object_id" TEXT,
    "output_object_version" INTEGER,
    "output_snapshot_hash" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_run_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_run_events" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "event_key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "detail" TEXT,
    "object_type" TEXT,
    "object_id" TEXT,
    "evidence_ids" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_run_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_run_approvals" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "object_type" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "object_version" INTEGER NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "account_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_by" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_run_approvals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_run_commands" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "result_status" TEXT NOT NULL,
    "result_version" INTEGER NOT NULL,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_run_commands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_runs_id_workspace_key" ON "agent_runs"("id", "workspace_id");
CREATE UNIQUE INDEX "agent_runs_workspace_request_key" ON "agent_runs"("workspace_id", "request_id");
CREATE INDEX "agent_runs_workspace_updated_idx" ON "agent_runs"("workspace_id", "updated_at", "id");
CREATE INDEX "agent_runs_status_deadline_idx" ON "agent_runs"("workspace_id", "status", "deadline_at");
CREATE INDEX "agent_runs_brand_updated_idx" ON "agent_runs"("brand_id", "updated_at");
CREATE INDEX "agent_runs_conversation_updated_idx" ON "agent_runs"("conversation_id", "updated_at");

CREATE UNIQUE INDEX "agent_run_steps_run_ordinal_key" ON "agent_run_steps"("run_id", "ordinal");
CREATE UNIQUE INDEX "agent_run_steps_workspace_idempotency_key" ON "agent_run_steps"("workspace_id", "idempotency_key");
CREATE UNIQUE INDEX "agent_run_steps_id_workspace_run_key" ON "agent_run_steps"("id", "workspace_id", "run_id");
CREATE INDEX "agent_run_steps_tenant_created_idx" ON "agent_run_steps"("workspace_id", "run_id", "created_at");

CREATE UNIQUE INDEX "agent_run_events_run_sequence_key" ON "agent_run_events"("run_id", "sequence");
CREATE UNIQUE INDEX "agent_run_events_run_event_key" ON "agent_run_events"("run_id", "event_key");
CREATE INDEX "agent_run_events_tenant_created_idx" ON "agent_run_events"("workspace_id", "run_id", "created_at");

CREATE UNIQUE INDEX "agent_run_approvals_step_id_key" ON "agent_run_approvals"("step_id");
CREATE UNIQUE INDEX "agent_run_approvals_workspace_request_key" ON "agent_run_approvals"("workspace_id", "request_id");
CREATE UNIQUE INDEX "agent_run_approvals_step_tenant_key" ON "agent_run_approvals"("step_id", "workspace_id", "run_id");
CREATE INDEX "agent_run_approvals_run_decided_idx" ON "agent_run_approvals"("run_id", "decided_at");

CREATE UNIQUE INDEX "agent_run_commands_workspace_request_key" ON "agent_run_commands"("workspace_id", "request_id");
CREATE INDEX "agent_run_commands_run_created_idx" ON "agent_run_commands"("run_id", "created_at");

ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_run_tenant_fkey" FOREIGN KEY ("run_id", "workspace_id") REFERENCES "agent_runs"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_run_tenant_fkey" FOREIGN KEY ("run_id", "workspace_id") REFERENCES "agent_runs"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_run_approvals" ADD CONSTRAINT "agent_run_approvals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_run_approvals" ADD CONSTRAINT "agent_run_approvals_run_tenant_fkey" FOREIGN KEY ("run_id", "workspace_id") REFERENCES "agent_runs"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_run_approvals" ADD CONSTRAINT "agent_run_approvals_step_tenant_fkey" FOREIGN KEY ("step_id", "workspace_id", "run_id") REFERENCES "agent_run_steps"("id", "workspace_id", "run_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_run_commands" ADD CONSTRAINT "agent_run_commands_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_run_commands" ADD CONSTRAINT "agent_run_commands_run_tenant_fkey" FOREIGN KEY ("run_id", "workspace_id") REFERENCES "agent_runs"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
