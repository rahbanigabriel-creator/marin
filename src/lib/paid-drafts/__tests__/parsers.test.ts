import assert from "node:assert/strict";
import test from "node:test";

import {
  PROVIDER_PAUSED_CONFIRMATION,
  parseConfirmProviderPausedBody,
  parseRecordExternalActivationOutcomeBody,
} from "../parsers";
import { PaidDraftValidationError } from "../validation";

const VALID_BODY = {
  requestId: "confirm-paused-001",
  expectedVersion: 3,
  snapshotHash: "a".repeat(64),
  providerCampaignId: "281498962108233",
  confirmation: PROVIDER_PAUSED_CONFIRMATION,
};

function expectCode(value: unknown, code: string): void {
  assert.throws(
    () => parseConfirmProviderPausedBody(value),
    (error: unknown) =>
      error instanceof PaidDraftValidationError && error.code === code,
  );
}

test("parses an exact unverified provider-paused assertion", () => {
  assert.deepEqual(parseConfirmProviderPausedBody(VALID_BODY), VALID_BODY);
});

test("rejects altered confirmations and non-canonical provider campaign IDs", () => {
  expectCode(
    { ...VALID_BODY, confirmation: "The campaign is probably paused" },
    "invalid_confirmation",
  );
  for (const providerCampaignId of [
    "",
    "281-498-9621",
    "campaign_123",
    " 123",
    "1".repeat(33),
  ]) {
    expectCode(
      { ...VALID_BODY, providerCampaignId },
      "invalid_provider_campaign_id",
    );
  }
});

test("rejects unknown fields and invalid snapshot bindings", () => {
  expectCode({ ...VALID_BODY, providerVerified: true }, "unknown_field");
  expectCode({ ...VALID_BODY, expectedVersion: 0 }, "invalid_version");
  expectCode({ ...VALID_BODY, snapshotHash: "A".repeat(64) }, "invalid_snapshot_hash");
});

test("records only a bounded external activation outcome against an exact attempt", () => {
  const body = {
    requestId: "record-activation-001",
    expectedVersion: 3,
    snapshotHash: "a".repeat(64),
    attemptId: "attempt_1",
    outcome: "not_activated",
  } as const;
  assert.deepEqual(parseRecordExternalActivationOutcomeBody(body), body);
  assert.throws(
    () => parseRecordExternalActivationOutcomeBody({ ...body, outcome: "probably_activated" }),
    (error: unknown) => error instanceof PaidDraftValidationError && error.code === "invalid_activation_outcome",
  );
  assert.throws(
    () => parseRecordExternalActivationOutcomeBody({ ...body, providerVerified: true }),
    (error: unknown) => error instanceof PaidDraftValidationError && error.code === "unknown_field",
  );
});
