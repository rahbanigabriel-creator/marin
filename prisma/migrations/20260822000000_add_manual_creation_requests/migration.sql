CREATE TABLE "manual_creation_requests" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "response_body" JSONB NOT NULL,
  "status_code" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "manual_creation_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "manual_creation_requests_workspace_operation_request_key"
  ON "manual_creation_requests"("workspace_id", "operation", "request_id");

CREATE INDEX "manual_creation_requests_workspace_created_idx"
  ON "manual_creation_requests"("workspace_id", "created_at");

ALTER TABLE "manual_creation_requests"
  ADD CONSTRAINT "manual_creation_requests_workspace_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
