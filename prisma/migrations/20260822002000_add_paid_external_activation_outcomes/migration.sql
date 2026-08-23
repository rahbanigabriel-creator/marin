ALTER TABLE "paid_campaign_draft_mutations"
    DROP CONSTRAINT "paid_draft_mutations_kind_check";

ALTER TABLE "paid_campaign_draft_mutations"
    ADD CONSTRAINT "paid_draft_mutations_kind_check"
    CHECK (
        "kind" IN (
            'create',
            'update',
            'mark_ready',
            'record_external_activation_outcome'
        )
    );
