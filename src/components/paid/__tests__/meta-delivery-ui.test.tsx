import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";
import type { PaidCampaignDraftDto, PaidCampaignOperationAttemptDto } from "@/lib/paid-drafts/dto";
import { createPaidDraftForm, buildPaidCampaignSnapshot } from "../paid-draft-form";
import { MetaDeliverySettings } from "../MetaDeliverySettings";
import { PaidDraftReview } from "../PaidDraftReview";
import { PaidDraftRequestError, checkMetaDraftReadiness, reconcileMetaDraft } from "../paid-draft-client";

function form() {
  const value = createPaidDraftForm({ id: "meta_connection", platform: "meta_ads", accountId: "123", accountName: "Marpin", currency: "EUR", timezone: "Europe/Madrid" });
  value.campaignName = "A paused Meta campaign";
  value.budgetMajor = "25";
  value.metaDelivery = { version: 1, pageId: "456", pageName: "Marpin Official", placement: "facebook_feed", specialAdCategory: "none", beneficiary: "Marpin Company", payer: "Gabriel" };
  value.metaCategoryConfirmed = true;
  const group = value.adGroups[0];
  Object.assign(group, { name: "Founders", locations: "ES", languages: "All languages" });
  Object.assign(group.ads[0], { name: "Launch", assetId: "image_1", primaryText: "Start the next chapter.", headline: "Meet Marpin", destinationUrl: "https://www.marpin.ai" });
  return value;
}

function draft(): PaidCampaignDraftDto {
  const snapshot = buildPaidCampaignSnapshot(form());
  const assisted = (operation: "activate" | "change_budget") => ({ operation, path: "assisted" as const, canExecuteProvider: false, assistedHandoffAvailable: true as const, reason: "provider_review_required" as const });
  return { id: "draft_1", platform: "meta_ads", source: "manual", template: "meta_traffic", connection: snapshot.connection, snapshot, snapshotHash: "a".repeat(64), version: 3, state: "ready", readyAt: null, createdAt: "2026-09-05T10:00:00Z", updatedAt: "2026-09-05T10:00:00Z", approvals: [], attempts: [], capabilities: { canManage: true, canEdit: true, canMarkReady: false, canApproveCreatePaused: true, canApproveActivation: false, execution: { mode: "provider_checked", createPaused: { operation: "create_paused", path: "provider_checked", canExecuteProvider: true, assistedHandoffAvailable: true, reason: "provider_preflight_required" }, activation: assisted("activate"), budgetChange: assisted("change_budget") } } };
}

function review(value: PaidCampaignDraftDto) {
  return parse(renderToStaticMarkup(<PaidDraftReview draft={value} busy={false} onEdit={() => undefined} onApprove={() => undefined} onExecute={() => undefined} onConfirmProviderPaused={() => undefined} onRecordActivationOutcome={() => undefined} onReconcileMeta={() => undefined} />));
}

test("delivery is opt-in and an existing Page remains visible without fetching or changing the form", () => {
  const value = form();
  const before = structuredClone(value);
  const selected = parse(renderToStaticMarkup(<MetaDeliverySettings value={value} disabled={false} onChange={() => assert.fail("Rendering must not change targeting")} />));
  assert.match(selected.querySelector('[aria-label="Facebook Page"]')?.textContent ?? "", /Marpin Official · saved selection/);
  const oauth = selected.querySelector('a[href="/api/connect/meta_ads?intent=paid_write"]');
  assert.equal(oauth?.getAttribute("target"), "_blank");
  assert.equal(oauth?.getAttribute("rel"), "noreferrer");
  assert.deepEqual(value, before);
  const withoutDelivery = { ...value, metaDelivery: undefined };
  const root = parse(renderToStaticMarkup(<MetaDeliverySettings value={withoutDelivery} disabled={false} onChange={() => assert.fail("Rendering must not enable delivery")} />));
  assert.equal(root.querySelector('input[type="checkbox"]')?.hasAttribute("checked"), false);
  assert.equal(root.querySelector('[aria-label="Facebook Page"]'), null);
});

test("Meta review requires a fresh readiness check and exposes exact delivery metadata", () => {
  const root = review(draft());
  const approve = root.querySelectorAll("button").find((button) => button.textContent.includes("Approve create paused"));
  assert.ok(approve?.hasAttribute("disabled"));
  assert.match(root.textContent, /Check Meta readiness/);
  assert.match(root.textContent, /Marpin Official/);
  assert.match(root.textContent, /Facebook feed only/);
  assert.match(root.textContent, /Marpin Company/);
  assert.match(root.textContent, /Gabriel/);
  assert.match(root.textContent, /This is not Meta app-review approval/);
  assert.doesNotMatch(root.textContent, /Reviewed provider execution/);
});

test("older-version Meta attempts with the same snapshot prevent another creation and show uncertainty", () => {
  const value = draft();
  const attempt: PaidCampaignOperationAttemptDto = { id: "attempt_1", approvalId: "approval_1", operation: "create_paused", snapshotVersion: 1, snapshotHash: value.snapshotHash, status: "needs_reconciliation", capabilityReason: "provider_preflight_required", providerOutcome: { kind: "meta_paused_creation", providerSideEffect: "possible", steps: [{ key: "campaign", kind: "campaign", status: "created", id: "789" }, { key: "adset", kind: "adset", status: "submitting" }], campaignId: "789", message: "Creation could not be verified." }, attemptedAt: "2026-09-05T10:00:00Z" };
  value.attempts = [attempt];
  const root = review(value);
  assert.doesNotMatch(root.textContent, /Approve create paused/);
  assert.match(root.textContent, /Creation requires verification/);
  assert.match(root.textContent, /No provider ID recorded/);
  assert.doesNotMatch(root.textContent, /Verified paused/);
  value.state = "needs_reconciliation";
  assert.match(review(value).textContent, /Check created objects/);
  value.state = "ready";
  value.attempts = [{ ...attempt, status: "running", providerOutcome: null }];
  assert.doesNotMatch(review(value).textContent, /Approve create paused/);
});

test("only a provider-verified current paused snapshot receives the verified badge", () => {
  const value = draft();
  value.state = "provider_paused";
  value.providerPausedConfirmation = { providerCampaignId: "789", snapshotVersion: 2, snapshotHash: value.snapshotHash, confirmedAt: "2026-09-05T10:00:00Z", verificationStatus: "user_asserted_unverified" };
  assert.doesNotMatch(review(value).textContent, /Verified paused/);
  value.providerPausedConfirmation.verificationStatus = "provider_verified";
  assert.match(review(value).textContent, /Verified paused/);
  value.providerPausedConfirmation.snapshotHash = "b".repeat(64);
  assert.doesNotMatch(review(value).textContent, /Verified paused/);
});

test("a failed attempt with proven no provider effect does not block a new exact approval", () => {
  const value = draft();
  value.attempts = [{ id: "failed_1", approvalId: "consumed_1", operation: "create_paused", snapshotVersion: 1, snapshotHash: value.snapshotHash, status: "failed", capabilityReason: "provider_preflight_required", providerOutcome: { kind: "meta_paused_creation", providerSideEffect: "none", steps: [], code: "permission_lost", message: "No provider changes were made." }, attemptedAt: "2026-09-05T10:00:00Z" }];
  const root = review(value);
  assert.match(root.textContent, /Previous attempt: no provider changes/);
  assert.match(root.textContent, /Approve create paused/);
  assert.doesNotMatch(root.textContent, /Creation requires verification/);
  assert.doesNotMatch(root.textContent, /Verified paused/);
});

test("billing failures retain only the approved local billing action", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ message: "Campaign execution requires a paid plan.", actionUrl: "/settings/billing" }, { status: 402 });
    await assert.rejects(checkMetaDraftReadiness("draft_1"), (error) => error instanceof PaidDraftRequestError && error.status === 402 && error.actionUrl === "/settings/billing");
    globalThis.fetch = async () => Response.json({ message: "Campaign execution requires a paid plan.", actionUrl: "https://untrusted.example/checkout" }, { status: 402 });
    await assert.rejects(checkMetaDraftReadiness("draft_1"), (error) => error instanceof PaidDraftRequestError && error.status === 402 && error.actionUrl === undefined);
  } finally { globalThis.fetch = original; }
});

test("readiness and reconciliation requests send no snapshot, approvals or provider operations", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ ready: true, version: 3, snapshotHash: "a".repeat(64), checkedAt: "2026-09-05T10:00:00Z" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await checkMetaDraftReadiness("draft_1");
    await reconcileMetaDraft("draft_1");
    assert.deepEqual(calls.map((call) => call.url), ["/api/paid/drafts/draft_1/meta-check", "/api/paid/drafts/draft_1/meta-reconcile"]);
    for (const call of calls) {
      assert.equal(call.init?.method, "POST");
      assert.equal(call.init?.credentials, "same-origin");
      assert.equal(call.init?.cache, "no-store");
      assert.equal(call.init?.body, undefined);
    }
  } finally { globalThis.fetch = original; }
});
