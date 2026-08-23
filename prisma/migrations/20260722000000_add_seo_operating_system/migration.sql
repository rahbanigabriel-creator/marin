CREATE TABLE "seo_tasks" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "brand_id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'medium',
  "priority" INTEGER NOT NULL DEFAULT 50,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "recommended_fix" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "verification_status" TEXT NOT NULL DEFAULT 'unverified',
  "completion_note" TEXT,
  "evidence" JSONB NOT NULL,
  "user_edited" BOOLEAN NOT NULL DEFAULT false,
  "analyzed_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "completed_by" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "seo_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seo_proposals" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "brand_id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "task_version" INTEGER NOT NULL,
  "request_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "instruction" TEXT,
  "recommended_fix" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "created_by" TEXT,
  "accepted_by" TEXT,
  "accepted_at" TIMESTAMP(3),
  "accepted_task_version" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "seo_proposals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seo_tasks_workspace_id_brand_id_fingerprint_key"
  ON "seo_tasks"("workspace_id", "brand_id", "fingerprint");
CREATE INDEX "seo_tasks_workspace_id_brand_id_status_priority_idx"
  ON "seo_tasks"("workspace_id", "brand_id", "status", "priority");
CREATE INDEX "seo_tasks_workspace_id_updated_at_idx"
  ON "seo_tasks"("workspace_id", "updated_at");

CREATE UNIQUE INDEX "seo_proposals_workspace_id_request_id_key"
  ON "seo_proposals"("workspace_id", "request_id");
CREATE INDEX "seo_proposals_task_id_status_created_at_idx"
  ON "seo_proposals"("task_id", "status", "created_at");
CREATE INDEX "seo_proposals_workspace_id_created_at_idx"
  ON "seo_proposals"("workspace_id", "created_at");

ALTER TABLE "seo_tasks"
  ADD CONSTRAINT "seo_tasks_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seo_tasks"
  ADD CONSTRAINT "seo_tasks_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "seo_proposals"
  ADD CONSTRAINT "seo_proposals_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seo_proposals"
  ADD CONSTRAINT "seo_proposals_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seo_proposals"
  ADD CONSTRAINT "seo_proposals_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "seo_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
