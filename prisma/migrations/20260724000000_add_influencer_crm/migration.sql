-- Sprint 11: tenant-safe influencer CRM, sourced metrics, assisted outreach,
-- and privacy-preserving aggregate tracking.

CREATE TABLE "influencer_profiles" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "brand_id" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "handle" TEXT NOT NULL,
  "normalized_handle" TEXT NOT NULL,
  "profile_url" TEXT NOT NULL,
  "display_name" TEXT,
  "contact_email" TEXT,
  "contact_name" TEXT,
  "topics" JSONB NOT NULL,
  "audience_countries" JSONB NOT NULL,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'prospect',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "request_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "last_activity_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "influencer_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "influencer_profiles_platform_check" CHECK (
    "platform" IN ('youtube', 'instagram', 'facebook', 'tiktok', 'snapchat', 'reddit', 'pinterest')
  ),
  CONSTRAINT "influencer_profiles_status_check" CHECK (
    "status" IN (
      'prospect', 'researching', 'qualified', 'outreach_ready', 'contacted',
      'replied', 'negotiating', 'active', 'declined', 'archived'
    )
  ),
  CONSTRAINT "influencer_profiles_source_check" CHECK (
    "source" IN ('manual', 'import', 'vendor')
  ),
  CONSTRAINT "influencer_profiles_version_check" CHECK ("version" > 0)
);

CREATE TABLE "influencer_metric_evidence" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "brand_id" TEXT NOT NULL,
  "profile_id" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "source_url" TEXT,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "source" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "recorded_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "influencer_metric_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "influencer_metric_name_check" CHECK (
    "metric" IN ('audience_size', 'average_views', 'engagement_rate')
  ),
  CONSTRAINT "influencer_metric_source_check" CHECK (
    "source" IN ('manual', 'public_profile', 'vendor')
  ),
  CONSTRAINT "influencer_metric_value_check" CHECK (
    "value" >= 0 AND
    ("metric" <> 'engagement_rate' OR "value" <= 100) AND
    ("metric" = 'engagement_rate' OR "value" = trunc("value"))
  ),
  CONSTRAINT "influencer_metric_version_check" CHECK ("version" > 0)
);

CREATE TABLE "influencer_outreach_drafts" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "brand_id" TEXT NOT NULL,
  "profile_id" TEXT NOT NULL,
  "profile_version" INTEGER NOT NULL,
  "request_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "subject" TEXT,
  "body" TEXT NOT NULL,
  "sponsorship_disclosure" TEXT NOT NULL,
  "claims_restrictions" TEXT,
  "compensation_note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "influencer_outreach_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "influencer_outreach_status_check" CHECK ("status" = 'draft'),
  CONSTRAINT "influencer_outreach_version_check" CHECK (
    "version" > 0 AND "profile_version" > 0
  )
);

CREATE TABLE "influencer_tracking_links" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "brand_id" TEXT NOT NULL,
  "profile_id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "destination_url" TEXT NOT NULL,
  "tagged_destination_url" TEXT NOT NULL,
  "campaign_key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "click_count" BIGINT NOT NULL DEFAULT 0,
  "last_clicked_at" TIMESTAMP(3),
  "disabled_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "influencer_tracking_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "influencer_tracking_click_count_check" CHECK ("click_count" >= 0),
  CONSTRAINT "influencer_tracking_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "influencer_profiles_workspace_request_key"
  ON "influencer_profiles"("workspace_id", "request_id");
CREATE UNIQUE INDEX "influencer_profiles_identity_key"
  ON "influencer_profiles"("workspace_id", "brand_id", "platform", "normalized_handle");
CREATE UNIQUE INDEX "influencer_profiles_id_workspace_brand_key"
  ON "influencer_profiles"("id", "workspace_id", "brand_id");
CREATE INDEX "influencer_profiles_activity_idx"
  ON "influencer_profiles"("workspace_id", "brand_id", "last_activity_at");
CREATE INDEX "influencer_profiles_status_idx"
  ON "influencer_profiles"("workspace_id", "brand_id", "status");

CREATE UNIQUE INDEX "influencer_metric_profile_metric_key"
  ON "influencer_metric_evidence"("profile_id", "metric");
CREATE INDEX "influencer_metric_observed_idx"
  ON "influencer_metric_evidence"("workspace_id", "brand_id", "observed_at");

CREATE UNIQUE INDEX "influencer_outreach_workspace_request_key"
  ON "influencer_outreach_drafts"("workspace_id", "request_id");
CREATE INDEX "influencer_outreach_profile_created_idx"
  ON "influencer_outreach_drafts"("profile_id", "created_at");

CREATE UNIQUE INDEX "influencer_tracking_links_slug_key"
  ON "influencer_tracking_links"("slug");
CREATE UNIQUE INDEX "influencer_tracking_workspace_request_key"
  ON "influencer_tracking_links"("workspace_id", "request_id");
CREATE INDEX "influencer_tracking_profile_created_idx"
  ON "influencer_tracking_links"("profile_id", "created_at");
CREATE INDEX "influencer_tracking_enabled_idx"
  ON "influencer_tracking_links"("workspace_id", "brand_id", "enabled");

ALTER TABLE "influencer_profiles"
  ADD CONSTRAINT "influencer_profiles_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "influencer_profiles"
  ADD CONSTRAINT "influencer_profiles_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "influencer_metric_evidence"
  ADD CONSTRAINT "influencer_metric_profile_tenant_fkey"
  FOREIGN KEY ("profile_id", "workspace_id", "brand_id")
  REFERENCES "influencer_profiles"("id", "workspace_id", "brand_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "influencer_outreach_drafts"
  ADD CONSTRAINT "influencer_outreach_profile_tenant_fkey"
  FOREIGN KEY ("profile_id", "workspace_id", "brand_id")
  REFERENCES "influencer_profiles"("id", "workspace_id", "brand_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "influencer_tracking_links"
  ADD CONSTRAINT "influencer_tracking_profile_tenant_fkey"
  FOREIGN KEY ("profile_id", "workspace_id", "brand_id")
  REFERENCES "influencer_profiles"("id", "workspace_id", "brand_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
