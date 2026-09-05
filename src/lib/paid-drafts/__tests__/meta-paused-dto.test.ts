import assert from "node:assert/strict";
import test from "node:test";

import { metaPausedFixture } from "../__fixtures__/meta-paused";
import { serverOwnedPaidConnectionWriteAccess } from "../capabilities";
import { paidProviderOutcome, toPaidCampaignDraftDto } from "../dto";
import type { MetaPausedStep } from "../meta-paused-provider";

function outcome(steps: unknown[]) {
  return {
    kind: "meta_paused_creation", providerSideEffect: "possible", steps,
    campaignId: "12345678901234567890123456789012", code: "meta_paused_checkpoint_failed",
    message: "Provider IDs retained for reconciliation.",
  };
}

function history(localId = "ad.1", assetId = "asset.1"): MetaPausedStep[] {
  return [
    { key: "campaign", kind: "campaign", status: "created", id: "1001" },
    { key: "adset", kind: "adset", status: "created", id: "1002" },
    { key: `image:${assetId}`, kind: "image", status: "created", id: "aAbB1234".repeat(4) },
    { key: `creative:${localId}`, kind: "creative", status: "created", id: "1004" },
    { key: `ad:${localId}`, kind: "ad", status: "submitting" },
  ];
}

for (const identifier of ["a", "ad.1", "A.1_b:c-d", "9._:-", "a".repeat(191), "a._:-".repeat(38) + "Z"]) {
  test(`valid identifiers preserve the whole Meta history (length ${identifier.length}: ${identifier.slice(0, 12)})`, () => {
    const stored = outcome(history(identifier, identifier));
    const parsed = paidProviderOutcome(stored);
    assert.deepEqual(parsed, stored);
    assert.notEqual(parsed, stored);
    assert.ok(parsed?.kind === "meta_paused_creation");
    assert.notEqual(parsed.steps, stored.steps);
    assert.notEqual(parsed.steps[0], stored.steps[0]);
  });
}

for (const kind of ["image", "creative", "ad"] as const) {
  test(`${kind} step keys allow 191-character identifiers but reject 192`, () => {
    const step: MetaPausedStep = {
      key: `${kind}:${"x".repeat(191)}`, kind, status: "created",
      id: kind === "image" ? "f".repeat(32) : "1004",
    };
    assert.deepEqual(paidProviderOutcome(outcome([step])), outcome([step]));
    assert.equal(paidProviderOutcome(outcome([{ ...step, key: step.key + "x" }])), null);
  });
}

for (const key of [
  "creative:", "creative:.ad", "creative:_ad", "creative:-ad", "creative::ad",
  "creative:ad/name", "creative:ad name", "creative:ad?1", "creative:ad%2e1", "creative:ad\n1",
  "creative:ad\n", "creative:ad\r", "creative:ad\r\n", "creative:ad\u2028", "creative:ad\u2029",
  "creative:ad\u00001", "creative:ad\u00e9", "creative:ad#1", "creative:ad@1", "ad:ad.1",
]) {
  test(`malformed or mismatched step key ${JSON.stringify(key)} is rejected`, () => {
    assert.equal(paidProviderOutcome(outcome([{ key, kind: "creative", status: "created", id: "1004" }])), null);
  });
}

test("campaign and adset keys must match their fixed internal names", () => {
  for (const kind of ["campaign", "adset"] as const) {
    assert.ok(paidProviderOutcome(outcome([{ key: kind, kind, status: "submitting" }])));
    for (const key of [`${kind}:a`, `${kind}.1`, kind.toUpperCase()]) {
      assert.equal(paidProviderOutcome(outcome([{ key, kind, status: "submitting" }])), null);
    }
  }
});

test("image hashes and unverified duplicate acknowledgements survive without coercing other IDs", () => {
  const steps = history();
  steps[1] = { key: "adset", kind: "adset", status: "submitting", id: steps[0].id };
  assert.deepEqual(paidProviderOutcome(outcome(steps)), outcome(steps));
  for (const id of [123, "", "1e4", "act_123", "1/ads", "1".repeat(33), "a".repeat(32)]) {
    assert.equal(paidProviderOutcome(outcome([{ ...steps[0], id }])), null);
  }
  for (const id of [123, "123", "g".repeat(32), "f".repeat(31), "f".repeat(33)]) {
    assert.equal(paidProviderOutcome(outcome([{ ...steps[2], id }])), null);
  }
});

test("step fields cannot be coerced from arrays or objects", () => {
  const step = history()[0];
  for (const invalid of [
    null, [], Object.assign([], step), { ...step, kind: ["campaign"] },
    { ...step, status: ["created"] }, { ...step, kind: { toString: () => "campaign" } },
    { ...step, status: { toString: () => "created" } }, { ...step, key: ["campaign"] },
  ]) {
    assert.equal(paidProviderOutcome(outcome([invalid])), null);
  }
});

test("DTO copies strip non-allowlisted properties while preserving all IDs", () => {
  const clean = outcome(history());
  const raw = {
    ...clean, accessToken: "sensitive-test-token", appSecretProof: "sensitive-test-proof",
    steps: clean.steps.map((step) => ({ ...step as MetaPausedStep, accessToken: "sensitive-test-token", response: { id: "9999" } })),
  };
  assert.deepEqual(paidProviderOutcome(raw), clean);
});

test("paused and uncertain outcomes retain their original side-effect classification", () => {
  for (const providerSideEffect of ["paused_objects", "possible"]) {
    const raw = { ...outcome(history()), providerSideEffect };
    assert.deepEqual(paidProviderOutcome(raw), raw);
  }
  assert.equal(paidProviderOutcome({ ...outcome(history()), providerSideEffect: "active" }), null);
  assert.equal(paidProviderOutcome(outcome(Array.from({ length: 21 }, () => history()[0]))), null);
});

test("confirmed no-write failures retain their none classification and failure code", () => {
  for (const steps of [[], [{ key: "campaign", kind: "campaign", status: "submitting" }]]) {
    const failed = { ...outcome(steps), providerSideEffect: "none", campaignId: undefined };
    const parsed = paidProviderOutcome(failed);
    assert.deepEqual(parsed, {
      kind: "meta_paused_creation", providerSideEffect: "none", steps,
      code: "meta_paused_checkpoint_failed", message: failed.message,
    });
  }
});

test("a confirmed no-write failed attempt remains failed in the full draft DTO", () => {
  const snapshot = metaPausedFixture();
  const timestamp = new Date("2026-09-05T12:00:00Z");
  const snapshotHash = "a".repeat(64);
  const failure = {
    kind: "meta_paused_creation", providerSideEffect: "none", steps: [],
    code: "meta_paused_checkpoint_failed", message: "No provider write was attempted.",
  };
  const draft = toPaidCampaignDraftDto({
    actorRole: "owner",
    writeAccess: serverOwnedPaidConnectionWriteAccess({ ...snapshot.connection, oauthConnected: true }),
    row: {
      id: "draft_1", platform: "meta_ads", connectionId: snapshot.connection.connectionId,
      accountId: snapshot.connection.accountId, accountName: snapshot.connection.accountName,
      source: "manual", template: "meta_traffic", state: "draft", snapshot,
      snapshotHash, version: 1, readyAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
      providerPausedConfirmation: null,
      approvals: [{ id: "approval_1", kind: "create_paused", snapshotVersion: 1, snapshotHash, approvedAt: timestamp, attempt: { id: "attempt_1" } }],
      attempts: [{
        id: "attempt_1", approvalId: "approval_1", operation: "create_paused", snapshotVersion: 1,
        snapshotHash, status: "failed", capabilityReason: "provider_preflight_required",
        providerOutcome: failure, attemptedAt: timestamp,
      }],
    },
  });
  assert.equal(draft.attempts[0].status, "failed");
  assert.deepEqual(draft.attempts[0].providerOutcome, failure);
  assert.equal(draft.approvals[0].status, "consumed");
  assert.equal(draft.capabilities.canEdit, true);
  assert.equal(draft.capabilities.canConfirmProviderPaused, false);
  assert.equal(draft.capabilities.canApproveActivation, false);
});

test("existing assisted-handoff and external-activation DTOs remain unchanged", () => {
  const assisted = { kind: "assisted_handoff", providerSideEffect: "none", message: "No provider writes.", nextSteps: ["Review in Meta."] };
  const external = { kind: "external_activation_outcome", providerSideEffect: "user_asserted_unverified", outcome: "not_activated", message: "Not activated." };
  assert.deepEqual(paidProviderOutcome(assisted), assisted);
  assert.deepEqual(paidProviderOutcome(external), external);
});
