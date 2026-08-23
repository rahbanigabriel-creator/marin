import { Prisma } from "@prisma/client";
import type Stripe from "stripe";

import {
  billingIntervalForStripePrice,
  planIdForStripePrice,
  type BillingInterval,
} from "@/lib/billing/plans";
import { prisma } from "@/lib/db";

export interface BillingEventResult {
  duplicate: boolean;
  handled: boolean;
  workspaceId: string | null;
}

function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

function metadataValue(
  metadata: Stripe.Metadata | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function intervalFromSubscription(
  priceId: string | null,
  item: Stripe.SubscriptionItem | undefined,
): BillingInterval | null {
  if (priceId) {
    const configured = billingIntervalForStripePrice(priceId);
    if (configured) return configured;
  }
  const recurring = item?.price?.recurring?.interval;
  if (recurring === "month") return "monthly";
  if (recurring === "year") return "annual";
  return null;
}

function grantsSolo(plan: string, status: string): boolean {
  return plan === "solo" && (status === "active" || status === "trialing");
}

async function validWorkspaceId(
  tx: Prisma.TransactionClient,
  candidate: string | null,
): Promise<string | null> {
  if (!candidate) return null;
  const workspace = await tx.workspace.findUnique({ where: { id: candidate }, select: { id: true } });
  return workspace?.id ?? null;
}

async function resolveWorkspaceId(
  tx: Prisma.TransactionClient,
  input: {
    metadataWorkspaceId?: string | null;
    customerId?: string | null;
    stripeSubId?: string | null;
  },
): Promise<string | null> {
  const candidates = new Set<string>();
  const fromMetadata = await validWorkspaceId(tx, input.metadataWorkspaceId ?? null);
  if (fromMetadata) candidates.add(fromMetadata);

  if (input.stripeSubId) {
    const bySubscription = await tx.subscription.findUnique({
      where: { stripeSubId: input.stripeSubId },
      select: { workspaceId: true },
    });
    if (bySubscription) candidates.add(bySubscription.workspaceId);
  }
  if (input.customerId) {
    const byCustomer = await tx.subscription.findUnique({
      where: { stripeCustomerId: input.customerId },
      select: { workspaceId: true },
    });
    if (byCustomer) candidates.add(byCustomer.workspaceId);
  }
  if (candidates.size > 1) {
    throw new Error("Verified Stripe identifiers resolve to different workspaces");
  }
  return candidates.values().next().value ?? null;
}

async function lockWorkspace(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "workspaces" WHERE "id" = ${workspaceId} FOR UPDATE
  `;
  if (!locked.length) throw new Error("Billing workspace no longer exists");
}

async function syncCheckoutSession(
  tx: Prisma.TransactionClient,
  session: Stripe.Checkout.Session,
): Promise<string | null> {
  if (session.mode !== "subscription") return null;
  const customerId = customerIdOf(session.customer ?? null);
  const stripeSubId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? null);
  const workspaceId = await resolveWorkspaceId(tx, {
    metadataWorkspaceId: session.client_reference_id ?? metadataValue(session.metadata, "workspaceId"),
    customerId,
    stripeSubId,
  });
  if (!workspaceId) throw new Error("Verified checkout could not be attributed to a workspace");

  await lockWorkspace(tx, workspaceId);
  const existing = await tx.subscription.findUnique({ where: { workspaceId } });
  if (existing) {
    await tx.subscription.update({
      where: { workspaceId },
      data: {
        ...(customerId ? { stripeCustomerId: customerId } : {}),
        ...(stripeSubId ? { stripeSubId } : {}),
      },
    });
  } else {
    await tx.subscription.create({
      data: {
        workspaceId,
        stripeCustomerId: customerId,
        stripeSubId,
        plan: "free",
        status: "pending",
      },
    });
  }
  return workspaceId;
}

async function syncSubscription(
  tx: Prisma.TransactionClient,
  event: Stripe.Event,
  subscription: Stripe.Subscription,
): Promise<string> {
  const customerId = customerIdOf(subscription.customer);
  const workspaceId = await resolveWorkspaceId(tx, {
    metadataWorkspaceId: metadataValue(subscription.metadata, "workspaceId"),
    customerId,
    stripeSubId: subscription.id,
  });
  if (!workspaceId) throw new Error("Verified subscription could not be attributed to a workspace");

  await lockWorkspace(tx, workspaceId);
  const existing = await tx.subscription.findUnique({ where: { workspaceId } });
  const eventAt = new Date(event.created * 1_000);

  const firstItem = subscription.items.data[0];
  const priceId = firstItem?.price?.id ?? null;
  // A signed Stripe event is authentic, but its metadata is not an entitlement
  // source. Only the exact configured Solo price can grant the paid plan.
  const plan = priceId && planIdForStripePrice(priceId) === "solo" ? "solo" : "free";
  if (existing?.lastStripeEventAt) {
    if (existing.lastStripeEventAt > eventAt) return workspaceId;
    if (
      existing.lastStripeEventAt.getTime() === eventAt.getTime() &&
      grantsSolo(plan, subscription.status) &&
      !grantsSolo(existing.plan, existing.status)
    ) {
      // Stripe event timestamps have one-second precision. For ambiguous
      // same-second delivery, permit downgrades but never a paid elevation.
      return workspaceId;
    }
  }
  const currentPeriodStart =
    typeof firstItem?.current_period_start === "number"
      ? new Date(firstItem.current_period_start * 1_000)
      : null;
  const currentPeriodEnd =
    typeof firstItem?.current_period_end === "number"
      ? new Date(firstItem.current_period_end * 1_000)
      : null;

  await tx.subscription.upsert({
    where: { workspaceId },
    update: {
      ...(customerId ? { stripeCustomerId: customerId } : {}),
      stripeSubId: subscription.id,
      stripePriceId: priceId,
      billingInterval: intervalFromSubscription(priceId, firstItem),
      plan,
      status: subscription.status,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      lastStripeEventAt: eventAt,
    },
    create: {
      workspaceId,
      stripeCustomerId: customerId,
      stripeSubId: subscription.id,
      stripePriceId: priceId,
      billingInterval: intervalFromSubscription(priceId, firstItem),
      plan,
      status: subscription.status,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      lastStripeEventAt: eventAt,
    },
  });
  return workspaceId;
}

/**
 * Process one already-signature-verified Stripe event. The event id insert and
 * subscription mutation share a transaction: duplicate delivery is a no-op and
 * any failed mutation rolls the receipt back so Stripe can retry safely.
 */
export async function processVerifiedStripeEvent(event: Stripe.Event): Promise<BillingEventResult> {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.billingEvent.createMany({
      data: [
        {
          stripeEventId: event.id,
          type: event.type,
          stripeCreatedAt: new Date(event.created * 1_000),
        },
      ],
      skipDuplicates: true,
    });
    if (receipt.count === 0) {
      return { duplicate: true, handled: true, workspaceId: null };
    }

    let workspaceId: string | null = null;
    let handled = true;
    switch (event.type) {
      case "checkout.session.completed":
        workspaceId = await syncCheckoutSession(tx, event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        workspaceId = await syncSubscription(tx, event, event.data.object as Stripe.Subscription);
        break;
      default:
        handled = false;
    }

    if (workspaceId) {
      await tx.billingEvent.update({
        where: { stripeEventId: event.id },
        data: { workspaceId },
      });
    }
    return { duplicate: false, handled, workspaceId };
  });
}
