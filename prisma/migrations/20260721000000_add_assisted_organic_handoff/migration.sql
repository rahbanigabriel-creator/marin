ALTER TABLE "publication_attempts"
  ADD COLUMN "request_hash" TEXT,
  ADD COLUMN "actor_id" TEXT,
  ADD COLUMN "content_version" INTEGER;

UPDATE "publication_attempts" AS attempt
SET
  "request_hash" = md5('legacy-publication-attempt:' || attempt."id") || md5(attempt."id" || ':marpin'),
  "content_version" = COALESCE(item."version", 0)
FROM "publications" AS publication
LEFT JOIN "content_items" AS item ON item."id" = publication."content_item_id"
WHERE publication."id" = attempt."publication_id";

UPDATE "publication_attempts"
SET
  "request_hash" = COALESCE(
    "request_hash",
    md5('legacy-publication-attempt:' || "id") || md5("id" || ':marpin')
  ),
  "content_version" = COALESCE("content_version", 0);

ALTER TABLE "publication_attempts"
  ALTER COLUMN "request_hash" SET DEFAULT (
    md5(random()::text || clock_timestamp()::text || txid_current()::text) ||
    md5(clock_timestamp()::text || random()::text || txid_current()::text)
  ),
  ALTER COLUMN "request_hash" SET NOT NULL,
  ALTER COLUMN "content_version" SET DEFAULT 0,
  ALTER COLUMN "content_version" SET NOT NULL;

DROP INDEX IF EXISTS "publication_attempts_idempotency_key_key";
DROP INDEX IF EXISTS "publication_attempts_publication_id_attempted_at_idx";

CREATE UNIQUE INDEX "publication_attempts_workspace_id_idempotency_key_key"
  ON "publication_attempts"("workspace_id", "idempotency_key");
CREATE INDEX "publication_attempts_publication_id_attempted_at_id_idx"
  ON "publication_attempts"("publication_id", "attempted_at", "id");
