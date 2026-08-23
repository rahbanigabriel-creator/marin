import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";

import {
  checkoutConflictPayload,
  isBlockingLocalSubscriptionStatus,
  isNonterminalStripeSubscriptionStatus,
  isOpenSubscriptionCheckout,
  subscriptionConflictPayload,
} from "@/lib/billing/checkout";

test("local checkout admission blocks every nonterminal billing state", () => {
  for (const status of [
    "pending",
    "active",
    "trialing",
    "incomplete",
    "past_due",
    "unpaid",
    "paused",
    "unknown_future_status",
  ]) {
    assert.equal(isBlockingLocalSubscriptionStatus(status), true, status);
  }

  for (const status of [null, undefined, "", "inactive", "canceled", "incomplete_expired"]) {
    assert.equal(isBlockingLocalSubscriptionStatus(status), false, String(status));
  }
});

test("Stripe reconciliation treats only canceled and incomplete_expired as terminal", () => {
  for (const status of ["active", "trialing", "incomplete", "past_due", "unpaid", "paused"] as const) {
    assert.equal(isNonterminalStripeSubscriptionStatus(status), true, status);
  }
  for (const status of ["canceled", "incomplete_expired"] as const) {
    assert.equal(isNonterminalStripeSubscriptionStatus(status), false, status);
  }
});

test("an open subscription Checkout Session is shared across billing intervals", () => {
  const base = {
    id: "cs_open",
    status: "open",
    mode: "subscription",
    client_reference_id: "workspace-1",
    metadata: { workspaceId: "workspace-1", interval: "monthly" },
    url: "https://checkout.stripe.test/cs_open",
  } as unknown as Stripe.Checkout.Session;

  assert.equal(isOpenSubscriptionCheckout(base), true);
  assert.equal(
    isOpenSubscriptionCheckout({ status: "open", mode: "subscription" }),
    true,
  );
  assert.equal(isOpenSubscriptionCheckout({ status: "complete", mode: "subscription" }), false);
  assert.equal(isOpenSubscriptionCheckout({ status: "open", mode: "payment" }), false);
});

test("checkout conflicts have stable typed 409 payloads", () => {
  assert.deepEqual(subscriptionConflictPayload("past_due"), {
    error: "subscription_exists",
    code: "subscription_exists",
    message: "This workspace already has a subscription that must be managed before starting another checkout.",
    manageUrl: "/settings/billing",
    subscriptionStatus: "past_due",
  });
  assert.deepEqual(
    checkoutConflictPayload({ id: "cs_open", url: "https://checkout.stripe.test/cs_open" }),
    {
      error: "checkout_in_progress",
      code: "checkout_in_progress",
      message: "A subscription checkout is already open for this workspace.",
      checkoutUrl: "https://checkout.stripe.test/cs_open",
      sessionId: "cs_open",
    },
  );
});
