-- Durable, non-cascading workspace deletion tombstones plus a replay ledger.
-- These tables intentionally do not reference workspaces so the tombstone
-- survives the tenant cascade and can prevent accidental recreation.
CREATE TABLE "workspace_deletion_requests" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "workspace_slug" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "dispatch_status" TEXT NOT NULL DEFAULT 'pending',
    "dispatch_error_code" TEXT,
    "stripe_status" TEXT NOT NULL DEFAULT 'pending',
    "blob_status" TEXT NOT NULL DEFAULT 'pending',
    "provider_outcomes" JSONB NOT NULL DEFAULT '[]',
    "warning_codes" JSONB NOT NULL DEFAULT '[]',
    "failure_code" TEXT,
    "failure_message" TEXT,
    "is_clerk_organization" BOOLEAN NOT NULL DEFAULT false,
    "clerk_user_deletion_eligible" BOOLEAN NOT NULL DEFAULT false,
    "clerk_status" TEXT NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workspace_deletion_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspace_deletion_requests_status_check" CHECK ("status" IN ('queued', 'processing', 'needs_attention', 'completed', 'completed_with_warnings')),
    CONSTRAINT "workspace_deletion_requests_dispatch_check" CHECK ("dispatch_status" IN ('pending', 'sent', 'unavailable', 'failed')),
    CONSTRAINT "workspace_deletion_requests_stripe_check" CHECK ("stripe_status" IN ('pending', 'confirmed', 'not_applicable', 'failed', 'unavailable')),
    CONSTRAINT "workspace_deletion_requests_blob_check" CHECK ("blob_status" IN ('pending', 'confirmed', 'not_applicable', 'failed', 'unavailable')),
    CONSTRAINT "workspace_deletion_requests_clerk_check" CHECK ("clerk_status" IN ('pending', 'confirmed', 'not_applicable', 'failed')),
    CONSTRAINT "workspace_deletion_requests_attempt_check" CHECK ("attempt" >= 0),
    CONSTRAINT "workspace_deletion_requests_version_check" CHECK ("version" >= 1),
    CONSTRAINT "workspace_deletion_requests_hash_check" CHECK ("request_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "workspace_deletion_requests_lengths_check" CHECK (
      char_length("workspace_id") BETWEEN 1 AND 191 AND
      char_length("workspace_slug") BETWEEN 1 AND 191 AND
      char_length("requested_by") BETWEEN 1 AND 191 AND
      char_length("request_id") BETWEEN 8 AND 100 AND
      char_length("stage") BETWEEN 1 AND 64 AND
      ("dispatch_error_code" IS NULL OR char_length("dispatch_error_code") BETWEEN 1 AND 64) AND
      ("failure_code" IS NULL OR char_length("failure_code") BETWEEN 1 AND 64) AND
      ("failure_message" IS NULL OR char_length("failure_message") BETWEEN 1 AND 256)
    ),
    CONSTRAINT "workspace_deletion_requests_outcomes_arrays_check" CHECK (
      jsonb_typeof("provider_outcomes") = 'array' AND jsonb_array_length("provider_outcomes") <= 4 AND
      jsonb_typeof("warning_codes") = 'array' AND jsonb_array_length("warning_codes") <= 12
    )
);

CREATE TABLE "workspace_deletion_commands" (
    "id" TEXT NOT NULL,
    "deletion_request_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "result_status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_deletion_commands_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspace_deletion_commands_hash_check" CHECK ("request_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "workspace_deletion_commands_kind_check" CHECK ("kind" IN ('retry')),
    CONSTRAINT "workspace_deletion_commands_result_check" CHECK ("result_status" IN ('pending', 'sent', 'unavailable', 'failed')),
    CONSTRAINT "workspace_deletion_commands_lengths_check" CHECK (
      char_length("deletion_request_id") BETWEEN 1 AND 191 AND
      char_length("requested_by") BETWEEN 1 AND 191 AND
      char_length("request_id") BETWEEN 8 AND 100
    )
);

CREATE UNIQUE INDEX "workspace_deletion_requests_workspace_id_key" ON "workspace_deletion_requests"("workspace_id");
CREATE UNIQUE INDEX "workspace_deletion_requests_workspace_slug_key" ON "workspace_deletion_requests"("workspace_slug");
CREATE UNIQUE INDEX "workspace_deletion_requests_requester_request_key" ON "workspace_deletion_requests"("requested_by", "request_id");
CREATE INDEX "workspace_deletion_requests_requester_updated_idx" ON "workspace_deletion_requests"("requested_by", "updated_at");
CREATE INDEX "workspace_deletion_requests_status_updated_idx" ON "workspace_deletion_requests"("status", "updated_at");

CREATE UNIQUE INDEX "workspace_deletion_commands_requester_request_key" ON "workspace_deletion_commands"("requested_by", "request_id");
CREATE INDEX "workspace_deletion_commands_request_created_idx" ON "workspace_deletion_commands"("deletion_request_id", "created_at");

ALTER TABLE "workspace_deletion_commands"
  ADD CONSTRAINT "workspace_deletion_commands_request_fkey"
  FOREIGN KEY ("deletion_request_id") REFERENCES "workspace_deletion_requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
