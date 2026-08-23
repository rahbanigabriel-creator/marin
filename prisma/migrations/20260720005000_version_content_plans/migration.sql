-- Add optimistic concurrency to content plan lifecycle and text mutations.
ALTER TABLE "content_plans"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
