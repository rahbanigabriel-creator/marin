-- Sprint 0: durable brand context, server-owned conversations, integrations and
-- channel accounts, plus the content-plan/calendar/publishing state machine.

ALTER TABLE "workspaces" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE "workspaces" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "workspaces" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'EUR';

ALTER TABLE "assets" ADD COLUMN "filename" TEXT;
ALTER TABLE "assets" ADD COLUMN "width" INTEGER;
ALTER TABLE "assets" ADD COLUMN "height" INTEGER;
ALTER TABLE "assets" ADD COLUMN "duration_ms" INTEGER;
ALTER TABLE "assets" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE "assets" ADD COLUMN "metadata" JSONB;

CREATE TABLE "action_attempts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "action_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "approved_payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "action_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website_url" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,
    "audience" JSONB,
    "voice" JSONB,
    "offers" JSONB,
    "competitors" JSONB,
    "proof_points" JSONB,
    "visual_style" JSONB,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "context_version" INTEGER NOT NULL DEFAULT 1,
    "audit_snapshot" JSONB,
    "audited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "title" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'assistant',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by" TEXT,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "turn_id" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "scopes" TEXT,
    "enc_access_token" TEXT NOT NULL,
    "enc_refresh_token" TEXT,
    "expires_at" TIMESTAMP(3),
    "external_user_id" TEXT,
    "metadata" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "channel_accounts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "display_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "capabilities" JSONB,
    "timezone" TEXT,
    "currency" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "channel_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "content_plans" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "strategy" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "content_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "content_items" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "plan_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idea',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "title" TEXT NOT NULL,
    "brief" TEXT,
    "core_copy" TEXT,
    "objective" TEXT,
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "content_item_assets" (
    "id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT NOT NULL DEFAULT 'media',
    "alt_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "content_item_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "publications" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "channel_account_id" TEXT,
    "platform" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT,
    "body" TEXT NOT NULL,
    "first_comment" TEXT,
    "link_url" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "external_id" TEXT,
    "permalink" TEXT,
    "publish_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "publication_attempts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "response" JSONB,
    "error" TEXT,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "publication_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "brands_workspace_id_is_primary_idx" ON "brands"("workspace_id", "is_primary");
CREATE UNIQUE INDEX "action_attempts_idempotency_key_key" ON "action_attempts"("idempotency_key");
CREATE INDEX "action_attempts_action_id_attempted_at_idx" ON "action_attempts"("action_id", "attempted_at");
CREATE INDEX "action_attempts_workspace_id_attempted_at_idx" ON "action_attempts"("workspace_id", "attempted_at");
CREATE INDEX "brands_workspace_id_website_url_idx" ON "brands"("workspace_id", "website_url");
CREATE INDEX "conversations_workspace_id_last_message_at_idx" ON "conversations"("workspace_id", "last_message_at");
CREATE INDEX "conversations_workspace_id_status_idx" ON "conversations"("workspace_id", "status");
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");
CREATE INDEX "messages_workspace_id_created_at_idx" ON "messages"("workspace_id", "created_at");
CREATE UNIQUE INDEX "messages_conversation_id_role_turn_id_key" ON "messages"("conversation_id", "role", "turn_id");
CREATE INDEX "integrations_workspace_id_provider_idx" ON "integrations"("workspace_id", "provider");
CREATE INDEX "integrations_workspace_id_status_idx" ON "integrations"("workspace_id", "status");
CREATE UNIQUE INDEX "channel_accounts_integration_id_platform_external_account_id_key" ON "channel_accounts"("integration_id", "platform", "external_account_id");
CREATE INDEX "channel_accounts_workspace_id_platform_status_idx" ON "channel_accounts"("workspace_id", "platform", "status");
CREATE INDEX "content_plans_workspace_id_start_date_end_date_idx" ON "content_plans"("workspace_id", "start_date", "end_date");
CREATE INDEX "content_plans_workspace_id_status_idx" ON "content_plans"("workspace_id", "status");
CREATE INDEX "content_items_workspace_id_status_updated_at_idx" ON "content_items"("workspace_id", "status", "updated_at");
CREATE INDEX "content_items_plan_id_created_at_idx" ON "content_items"("plan_id", "created_at");
CREATE UNIQUE INDEX "content_item_assets_content_item_id_asset_id_key" ON "content_item_assets"("content_item_id", "asset_id");
CREATE INDEX "content_item_assets_content_item_id_position_idx" ON "content_item_assets"("content_item_id", "position");
CREATE INDEX "publications_workspace_id_scheduled_at_idx" ON "publications"("workspace_id", "scheduled_at");
CREATE INDEX "publications_workspace_id_platform_status_idx" ON "publications"("workspace_id", "platform", "status");
CREATE INDEX "publications_content_item_id_platform_idx" ON "publications"("content_item_id", "platform");
CREATE INDEX "publication_attempts_publication_id_attempted_at_idx" ON "publication_attempts"("publication_id", "attempted_at");
CREATE INDEX "publication_attempts_workspace_id_attempted_at_idx" ON "publication_attempts"("workspace_id", "attempted_at");
CREATE UNIQUE INDEX "publication_attempts_idempotency_key_key" ON "publication_attempts"("idempotency_key");

ALTER TABLE "action_attempts" ADD CONSTRAINT "action_attempts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "action_attempts" ADD CONSTRAINT "action_attempts_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brands" ADD CONSTRAINT "brands_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "content_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "content_item_assets" ADD CONSTRAINT "content_item_assets_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_item_assets" ADD CONSTRAINT "content_item_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "publications" ADD CONSTRAINT "publications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "publications" ADD CONSTRAINT "publications_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "publications" ADD CONSTRAINT "publications_channel_account_id_fkey" FOREIGN KEY ("channel_account_id") REFERENCES "channel_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "publication_attempts" ADD CONSTRAINT "publication_attempts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "publication_attempts" ADD CONSTRAINT "publication_attempts_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
