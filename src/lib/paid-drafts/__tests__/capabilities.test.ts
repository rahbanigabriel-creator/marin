import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransitionPaidDraftState,
  consumePaidOperationApproval,
  evaluatePaidOperation,
  paidDraftCapabilities,
  serverOwnedPaidConnectionWriteAccess,
  transitionPaidDraftState,
  type PaidConnectionWriteAccess,
  type PaidOperationApproval,
  type PaidOperationRequest,
} from "../capabilities";

const SNAPSHOT_HASH = "a".repeat(64);

function access(
  changes: Partial<PaidConnectionWriteAccess> = {},
): PaidConnectionWriteAccess {
  return {
    platform: "google_ads",
    connectionId: "connection_1",
    accountId: "account_1",
    oauthConnected: true,
    providerReviewStatus: "approved",
    grantedOperations: ["create_paused", "activate", "change_budget"],
    ...changes,
  };
}

function request(
  operation: PaidOperationRequest["operation"],
  state: PaidOperationRequest["state"],
  changes: Partial<PaidOperationRequest> = {},
): PaidOperationRequest {
  return {
    operation,
    state,
    platform: "google_ads",
    connectionId: "connection_1",
    accountId: "account_1",
    snapshotVersion: 7,
    snapshotHash: SNAPSHOT_HASH,
    ...changes,
  };
}

function approval(
  kind: PaidOperationApproval["kind"],
  changes: Partial<PaidOperationApproval> = {},
): PaidOperationApproval {
  return {
    approvalId: `approval_${kind}`,
    status: "approved",
    kind,
    platform: "google_ads",
    connectionId: "connection_1",
    accountId: "account_1",
    snapshotVersion: 7,
    snapshotHash: SNAPSHOT_HASH,
    ...changes,
  };
}

test("OAuth connectivity alone always falls back to assisted handoff", () => {
  const capabilities = paidDraftCapabilities(access({
    providerReviewStatus: "not_requested",
    grantedOperations: ["create_paused", "activate", "change_budget"],
  }));
  assert.equal(capabilities.mode, "assisted");
  assert.equal(capabilities.createPaused.canExecuteProvider, false);
  assert.equal(capabilities.createPaused.path, "assisted");
  assert.equal(capabilities.createPaused.assistedHandoffAvailable, true);
  assert.equal(capabilities.createPaused.reason, "provider_review_required");

  const decision = evaluatePaidOperation(
    request("create_paused", "ready"),
    approval("create_paused"),
    access({ providerReviewStatus: "not_requested" }),
  );
  assert.deepEqual(decision, {
    allowed: false,
    reason: "provider_write_unavailable",
    useAssistedHandoff: true,
  });
});

test("server-owned access cannot enable a provider writer that was not shipped", () => {
  const serverAccess = serverOwnedPaidConnectionWriteAccess({
    platform: "google_ads",
    connectionId: "connection_1",
    accountId: "account_1",
    oauthConnected: true,
  });
  assert.deepEqual(serverAccess.grantedOperations, []);
  assert.equal(serverAccess.providerReviewStatus, "not_requested");
  assert.equal(paidDraftCapabilities(serverAccess).createPaused.canExecuteProvider, false);
});

test("provider review and an explicit operation grant are both required", () => {
  const capabilities = paidDraftCapabilities(access({ grantedOperations: ["create_paused"] }));
  assert.equal(capabilities.mode, "provider_reviewed");
  assert.equal(capabilities.createPaused.canExecuteProvider, true);
  assert.equal(capabilities.activation.canExecuteProvider, false);
  assert.equal(capabilities.activation.reason, "operation_not_granted");

  const rejected = paidDraftCapabilities(access({ providerReviewStatus: "rejected" }));
  assert.equal(rejected.mode, "assisted");
  assert.equal(rejected.budgetChange.reason, "provider_review_rejected");

  const malformed = paidDraftCapabilities(access({
    providerReviewStatus: "unexpected" as PaidConnectionWriteAccess["providerReviewStatus"],
  }));
  assert.equal(malformed.mode, "assisted");
  assert.equal(malformed.createPaused.reason, "operation_not_granted");
});

test("runtime-cast unsupported operations fail closed without throwing", () => {
  const unsupported = "delete_campaign" as PaidOperationRequest["operation"];
  assert.deepEqual(
    evaluatePaidOperation(
      request(unsupported, "active"),
      approval("activate"),
      access(),
    ),
    { allowed: false, reason: "invalid_operation", useAssistedHandoff: false },
  );
});

test("creation approval binds the exact snapshot and can only create paused", () => {
  const decision = evaluatePaidOperation(
    request("create_paused", "ready"),
    approval("create_paused"),
    access(),
  );
  assert.equal(decision.allowed, true);
  if (!decision.allowed) assert.fail("Expected paused creation approval");
  assert.equal(decision.nextState, "creating_paused");
  assert.equal(decision.providerCreateStatus, "paused");
});

test("stale versions, hashes, and cross-account approvals fail closed", () => {
  assert.deepEqual(
    evaluatePaidOperation(
      request("create_paused", "ready", { snapshotVersion: 8 }),
      approval("create_paused"),
      access(),
    ),
    { allowed: false, reason: "stale_approval", useAssistedHandoff: false },
  );
  assert.deepEqual(
    evaluatePaidOperation(
      request("create_paused", "ready", { snapshotHash: "b".repeat(64) }),
      approval("create_paused"),
      access(),
    ),
    { allowed: false, reason: "stale_approval", useAssistedHandoff: false },
  );
  assert.deepEqual(
    evaluatePaidOperation(
      request("create_paused", "ready"),
      approval("create_paused", { accountId: "account_2" }),
      access(),
    ),
    { allowed: false, reason: "account_mismatch", useAssistedHandoff: false },
  );
  assert.deepEqual(
    evaluatePaidOperation(
      request("create_paused", "ready", { connectionId: "connection_2" }),
      approval("create_paused"),
      access(),
    ),
    { allowed: false, reason: "account_mismatch", useAssistedHandoff: false },
  );
});

test("activation requires a separate exact approval and cannot run twice", () => {
  assert.deepEqual(
    evaluatePaidOperation(
      request("activate", "provider_paused"),
      approval("create_paused"),
      access(),
    ),
    { allowed: false, reason: "approval_kind_mismatch", useAssistedHandoff: false },
  );

  const activationApproval = approval("activate");
  const first = evaluatePaidOperation(
    request("activate", "provider_paused"),
    activationApproval,
    access(),
  );
  assert.equal(first.allowed, true);
  if (!first.allowed) assert.fail("Expected activation approval");
  assert.equal(first.nextState, "activating");

  assert.deepEqual(
    evaluatePaidOperation(
      request("activate", "provider_paused"),
      consumePaidOperationApproval(activationApproval),
      access(),
    ),
    { allowed: false, reason: "approval_consumed", useAssistedHandoff: false },
  );
  assert.deepEqual(
    evaluatePaidOperation(
      request("activate", "activation_requested"),
      approval("activate"),
      access(),
    ),
    { allowed: false, reason: "invalid_state", useAssistedHandoff: false },
  );
});

test("budget changes are separately approved and gated", () => {
  assert.deepEqual(
    evaluatePaidOperation(
      request("change_budget", "active"),
      approval("activate"),
      access(),
    ),
    { allowed: false, reason: "approval_kind_mismatch", useAssistedHandoff: false },
  );
  const allowed = evaluatePaidOperation(
    request("change_budget", "active"),
    approval("change_budget"),
    access(),
  );
  assert.equal(allowed.allowed, true);
  if (!allowed.allowed) assert.fail("Expected budget approval");
  assert.equal(allowed.nextState, "active");

  const assisted = evaluatePaidOperation(
    request("change_budget", "active"),
    approval("change_budget"),
    access({ grantedOperations: ["create_paused", "activate"] }),
  );
  assert.deepEqual(assisted, {
    allowed: false,
    reason: "provider_write_unavailable",
    useAssistedHandoff: true,
  });
});

test("state transitions follow the launch chain and reconcile uncertain effects", () => {
  assert.equal(transitionPaidDraftState("draft", "ready"), "ready");
  assert.equal(transitionPaidDraftState("ready", "creating_paused"), "creating_paused");
  assert.equal(canTransitionPaidDraftState("ready", "provider_paused"), false);
  assert.equal(
    transitionPaidDraftState("ready", "provider_paused", {
      assistedConfirmation: true,
    }),
    "provider_paused",
  );
  assert.equal(transitionPaidDraftState("creating_paused", "provider_paused"), "provider_paused");
  assert.equal(transitionPaidDraftState("provider_paused", "activating"), "activating");
  assert.equal(transitionPaidDraftState("activating", "activation_requested"), "activation_requested");
  assert.equal(transitionPaidDraftState("activation_requested", "in_review"), "in_review");
  assert.equal(transitionPaidDraftState("in_review", "active"), "active");
  assert.equal(canTransitionPaidDraftState("provider_paused", "active"), false);
  assert.equal(
    transitionPaidDraftState("provider_paused", "active", {
      assistedActivationOutcome: true,
    }),
    "active",
  );

  assert.equal(canTransitionPaidDraftState("activating", "needs_reconciliation"), false);
  assert.equal(
    canTransitionPaidDraftState("activating", "needs_reconciliation", {
      uncertainExternalEffect: true,
    }),
    true,
  );
  assert.equal(
    canTransitionPaidDraftState("needs_reconciliation", "activating", { reconciled: true }),
    false,
  );
  assert.equal(
    transitionPaidDraftState("needs_reconciliation", "provider_paused", { reconciled: true }),
    "provider_paused",
  );
  assert.throws(() => transitionPaidDraftState("active", "activating"));
});
