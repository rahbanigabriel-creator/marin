-- Bind each metered turn id to the request it was created for. Legacy rows get
-- an impossible-to-reproduce sentinel so they cannot be replayed for free.

ALTER TABLE "usage_events" ADD COLUMN "request_hash" TEXT;

UPDATE "usage_events"
SET "request_hash" = 'legacy:' || "id";

ALTER TABLE "usage_events"
  ALTER COLUMN "request_hash" SET DEFAULT (
    md5(random()::text || clock_timestamp()::text || txid_current()::text) ||
    md5(clock_timestamp()::text || random()::text || txid_current()::text)
  ),
  ALTER COLUMN "request_hash" SET NOT NULL;
