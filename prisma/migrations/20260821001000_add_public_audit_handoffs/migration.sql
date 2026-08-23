CREATE TABLE "audit_handoffs" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "final_url" TEXT NOT NULL,
    "audit_snapshot" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_handoffs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_handoffs_token_hash_check" CHECK ("token_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "audit_handoffs_final_url_check" CHECK (octet_length("final_url") BETWEEN 1 AND 2048)
);

CREATE UNIQUE INDEX "audit_handoffs_token_hash_key"
    ON "audit_handoffs"("token_hash");
CREATE INDEX "audit_handoffs_expires_at_idx"
    ON "audit_handoffs"("expires_at");
