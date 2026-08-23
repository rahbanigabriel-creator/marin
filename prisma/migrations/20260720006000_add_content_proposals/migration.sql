CREATE TABLE "content_proposals" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "brand_id" TEXT NOT NULL,
  "content_item_id" TEXT NOT NULL,
  "publication_id" TEXT,
  "request_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "platform" TEXT,
  "format" TEXT,
  "fields" JSONB NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "created_by" TEXT,
  "accepted_by" TEXT,
  "accepted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "content_proposals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_proposals_workspace_id_request_id_key"
  ON "content_proposals"("workspace_id", "request_id");
CREATE INDEX "content_proposals_content_item_id_status_created_at_idx"
  ON "content_proposals"("content_item_id", "status", "created_at");
CREATE INDEX "content_proposals_workspace_id_created_at_idx"
  ON "content_proposals"("workspace_id", "created_at");

ALTER TABLE "content_proposals"
  ADD CONSTRAINT "content_proposals_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_proposals"
  ADD CONSTRAINT "content_proposals_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_proposals"
  ADD CONSTRAINT "content_proposals_content_item_id_fkey"
  FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_proposals"
  ADD CONSTRAINT "content_proposals_publication_id_fkey"
  FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
