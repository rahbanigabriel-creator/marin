-- Ensure a workspace can never have two primary Brands, including under
-- concurrent audit/update requests. Keep the most recently edited row primary
-- if historical data already contains duplicates.

WITH ranked_primary_brands AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "workspace_id"
      ORDER BY "updated_at" DESC, "id" DESC
    ) AS row_number
  FROM "brands"
  WHERE "is_primary" = true
)
UPDATE "brands" AS brand
SET "is_primary" = false
FROM ranked_primary_brands AS ranked
WHERE brand."id" = ranked."id"
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX "brands_one_primary_per_workspace_key"
  ON "brands"("workspace_id")
  WHERE "is_primary" = true;
