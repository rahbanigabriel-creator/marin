-- Additive states for checkpointed, paused-only Meta creation.
BEGIN;
ALTER TABLE "paid_campaign_operation_attempts"
  DROP CONSTRAINT "paid_operation_attempts_status_check",
  ADD CONSTRAINT "paid_operation_attempts_status_check"
    CHECK ("status" IN ('assisted_handoff', 'running', 'succeeded', 'failed', 'needs_reconciliation'));
ALTER TABLE "paid_campaign_provider_paused_confirmations"
  DROP CONSTRAINT "paid_provider_confirmations_verification_check",
  ADD CONSTRAINT "paid_provider_confirmations_verification_check"
    CHECK ("verification_status" IN ('user_asserted_unverified', 'provider_verified'));
COMMIT;
