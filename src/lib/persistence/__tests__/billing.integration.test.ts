import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";

import { isEntitlementDeniedError } from "../../billing/errors";
import { resolveWorkspaceBillingPolicy } from "../../billing/entitlements";
import {
  answerRequestFingerprint,
  commitUsageReservation,
  reserveAnswerUsage,
} from "../../billing/usage";
import { processVerifiedStripeEvent } from "../../billing/webhook";
import { persistEncryptedConnection } from "../../connectors/persist";
import { prisma } from "../../db";

function disposableDatabaseEnabled(): boolean {
  if (process.env.MARPIN_INTEGRATION_DATABASE !== "1") return false;
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      /(?:_test|_ci)$/.test(url.pathname.slice(1))
    );
  } catch {
    return false;
  }
}

const integrationTest = disposableDatabaseEnabled() ? test : test.skip;

function subscriptionEvent(input: {
  id: string;
  workspaceId: string;
  customerId: string;
  subscriptionId: string;
  created: number;
  status: Stripe.Subscription.Status;
  periodStart: number;
  periodEnd: number;
  priceId?: string;
  interval?: "month" | "year";
}): Stripe.Event {
  return {
    id: input.id,
    type: "customer.subscription.updated",
    created: input.created,
    data: {
      object: {
        id: input.subscriptionId,
        customer: input.customerId,
        status: input.status,
        metadata: { workspaceId: input.workspaceId, plan: "solo", interval: "monthly" },
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: {
                id: input.priceId ?? "price_solo_test",
                recurring: { interval: input.interval ?? "month" },
              },
              current_period_start: input.periodStart,
              current_period_end: input.periodEnd,
            },
          ],
        },
      },
    },
  } as unknown as Stripe.Event;
}

integrationTest("billing limits, retries, and verified Stripe ordering are tenant-safe", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const freeWorkspace = await prisma.workspace.create({
    data: { name: "Free billing", slug: `free-billing-${suffix}` },
  });
  const soloWorkspace = await prisma.workspace.create({
    data: { name: "Solo billing", slug: `solo-billing-${suffix}` },
  });
  const previousPrice = process.env.STRIPE_PRICE_SOLO_MONTHLY;
  const previousAnnualPrice = process.env.STRIPE_PRICE_SOLO_ANNUAL;
  process.env.STRIPE_PRICE_SOLO_MONTHLY = "price_solo_test";
  process.env.STRIPE_PRICE_SOLO_ANNUAL = "price_solo_annual_test";

  try {
    for (let index = 1; index <= 25; index += 1) {
      const turn = `free-turn-${index}`;
      const reservation = await reserveAnswerUsage({
        workspaceId: freeWorkspace.id,
        idempotencyKey: turn,
        requestHash: answerRequestFingerprint({ question: turn }),
        credits: 1,
        model: "claude-sonnet-4-6",
        requiresOpus: false,
      });
      assert.equal(reservation.allowed, true);
      if (index === 1) {
        const pendingRetry = await reserveAnswerUsage({
          workspaceId: freeWorkspace.id,
          idempotencyKey: turn,
          requestHash: answerRequestFingerprint({ question: turn }),
          credits: 1,
          model: "claude-sonnet-4-6",
          requiresOpus: false,
        });
        assert.equal(pendingRetry.allowed, false);
        assert.equal(pendingRetry.code, "request_in_progress");
        assert.equal(pendingRetry.reserved, 1);
      }
      assert.equal(await commitUsageReservation(freeWorkspace.id, turn), true);
    }

    const retry = await reserveAnswerUsage({
      workspaceId: freeWorkspace.id,
      idempotencyKey: "free-turn-1",
      requestHash: answerRequestFingerprint({ question: "free-turn-1" }),
      credits: 1,
      model: "claude-sonnet-4-6",
      requiresOpus: false,
    });
    assert.equal(retry.allowed, false);
    assert.equal(retry.code, "idempotency_conflict");
    assert.equal(retry.used, 25);
    assert.equal(
      await prisma.usageEvent.count({ where: { workspaceId: freeWorkspace.id } }),
      25,
    );

    const overLimit = await reserveAnswerUsage({
      workspaceId: freeWorkspace.id,
      idempotencyKey: "free-turn-26",
      requestHash: answerRequestFingerprint({ question: "free-turn-26" }),
      credits: 1,
      model: "claude-sonnet-4-6",
      requiresOpus: false,
    });
    assert.equal(overLimit.allowed, false);
    assert.equal(overLimit.code, "credit_limit");

    const opus = await reserveAnswerUsage({
      workspaceId: freeWorkspace.id,
      idempotencyKey: "free-opus",
      requestHash: answerRequestFingerprint({ question: "free-opus" }),
      credits: 2,
      model: "claude-opus-4-8",
      requiresOpus: true,
    });
    assert.equal(opus.allowed, false);
    assert.equal(opus.code, "model_not_in_plan");

    await persistEncryptedConnection({
      workspaceId: freeWorkspace.id,
      platform: "ga4",
      externalAccountId: "ga4-1",
      encAccessToken: "encrypted-test-token",
    });
    await assert.rejects(
      () =>
        persistEncryptedConnection({
          workspaceId: freeWorkspace.id,
          platform: "search_console",
          externalAccountId: "gsc-1",
          encAccessToken: "encrypted-test-token",
        }),
      isEntitlementDeniedError,
    );
    await persistEncryptedConnection({
      workspaceId: freeWorkspace.id,
      platform: "ga4",
      externalAccountId: "ga4-1",
      displayName: "Reconnected",
      encAccessToken: "encrypted-new-token",
    });

    const now = Math.floor(Date.now() / 1_000);
    const active = subscriptionEvent({
      id: `evt-active-${suffix}`,
      workspaceId: soloWorkspace.id,
      customerId: `cus-${suffix}`,
      subscriptionId: `sub-${suffix}`,
      created: now,
      status: "active",
      periodStart: now - 30 * 86_400,
      periodEnd: now + 335 * 86_400,
      priceId: "price_solo_annual_test",
      interval: "year",
    });
    const first = await processVerifiedStripeEvent(active);
    const duplicate = await processVerifiedStripeEvent(active);
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    const activePolicy = await resolveWorkspaceBillingPolicy(soloWorkspace.id);
    const policyNow = new Date();
    assert.equal(activePolicy.planId, "solo");
    assert.equal(
      activePolicy.periodStart.toISOString(),
      new Date(Date.UTC(policyNow.getUTCFullYear(), policyNow.getUTCMonth(), 1)).toISOString(),
    );
    assert.equal(
      activePolicy.periodEnd.toISOString(),
      new Date(Date.UTC(policyNow.getUTCFullYear(), policyNow.getUTCMonth() + 1, 1)).toISOString(),
    );
    assert.equal(
      (await prisma.subscription.findUniqueOrThrow({ where: { workspaceId: soloWorkspace.id } }))
        .billingInterval,
      "annual",
    );
    assert.equal(
      await prisma.billingEvent.count({ where: { stripeEventId: active.id } }),
      1,
    );

    const conflictingTenant = subscriptionEvent({
      id: `evt-conflicting-tenant-${suffix}`,
      workspaceId: freeWorkspace.id,
      customerId: `cus-${suffix}`,
      subscriptionId: `sub-${suffix}`,
      created: now + 1,
      status: "active",
      periodStart: now - 30 * 86_400,
      periodEnd: now + 335 * 86_400,
      priceId: "price_solo_annual_test",
      interval: "year",
    });
    await assert.rejects(() => processVerifiedStripeEvent(conflictingTenant));
    assert.equal(
      await prisma.billingEvent.count({ where: { stripeEventId: conflictingTenant.id } }),
      0,
    );
    assert.equal(
      await prisma.subscription.count({ where: { workspaceId: freeWorkspace.id } }),
      0,
    );

    const staleCancellation = subscriptionEvent({
      id: `evt-stale-${suffix}`,
      workspaceId: soloWorkspace.id,
      customerId: `cus-${suffix}`,
      subscriptionId: `sub-${suffix}`,
      created: now - 120,
      status: "canceled",
      periodStart: now - 40 * 86_400,
      periodEnd: now - 10 * 86_400,
    });
    await processVerifiedStripeEvent(staleCancellation);
    const stored = await prisma.subscription.findUniqueOrThrow({
      where: { workspaceId: soloWorkspace.id },
    });
    assert.equal(stored.status, "active");
    assert.equal((await resolveWorkspaceBillingPolicy(soloWorkspace.id)).planId, "solo");

    const sameSecondCancellation = subscriptionEvent({
      id: `evt-cancel-${suffix}`,
      workspaceId: soloWorkspace.id,
      customerId: `cus-${suffix}`,
      subscriptionId: `sub-${suffix}`,
      created: now,
      status: "canceled",
      periodStart: now - 86_400,
      periodEnd: now,
    });
    await processVerifiedStripeEvent(sameSecondCancellation);
    assert.equal((await resolveWorkspaceBillingPolicy(soloWorkspace.id)).planId, "free");

    const ambiguousReactivation = subscriptionEvent({
      id: `evt-reactivate-${suffix}`,
      workspaceId: soloWorkspace.id,
      customerId: `cus-${suffix}`,
      subscriptionId: `sub-${suffix}`,
      created: now,
      status: "active",
      periodStart: now - 86_400,
      periodEnd: now + 30 * 86_400,
    });
    await processVerifiedStripeEvent(ambiguousReactivation);
    assert.equal((await resolveWorkspaceBillingPolicy(soloWorkspace.id)).planId, "free");

    const unknownPrice = subscriptionEvent({
      id: `evt-unknown-price-${suffix}`,
      workspaceId: soloWorkspace.id,
      customerId: `cus-${suffix}`,
      subscriptionId: `sub-${suffix}`,
      created: now + 60,
      status: "active",
      periodStart: now,
      periodEnd: now + 30 * 86_400,
      priceId: "price_not_owned_by_marpin",
    });
    await processVerifiedStripeEvent(unknownPrice);
    const unknownStored = await prisma.subscription.findUniqueOrThrow({
      where: { workspaceId: soloWorkspace.id },
    });
    assert.equal(unknownStored.plan, "free");
    assert.equal((await resolveWorkspaceBillingPolicy(soloWorkspace.id)).planId, "free");
  } finally {
    if (previousPrice === undefined) delete process.env.STRIPE_PRICE_SOLO_MONTHLY;
    else process.env.STRIPE_PRICE_SOLO_MONTHLY = previousPrice;
    if (previousAnnualPrice === undefined) delete process.env.STRIPE_PRICE_SOLO_ANNUAL;
    else process.env.STRIPE_PRICE_SOLO_ANNUAL = previousAnnualPrice;
    await prisma.workspace.delete({ where: { id: freeWorkspace.id } }).catch(() => undefined);
    await prisma.workspace.delete({ where: { id: soloWorkspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
