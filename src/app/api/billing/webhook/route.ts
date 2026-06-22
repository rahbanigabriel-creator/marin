import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { getStripe, isBillingConfigured, isWebhookConfigured } from "@/lib/billing/stripe";
import { isDatabaseConfigured } from "@/lib/db";
import { planIdForStripePrice, type PlanId } from "@/lib/billing/plans";

/**
 * POST /api/billing/webhook — Stripe subscription lifecycle sync.
 *
 * SECURITY (non-negotiable): every event is VERIFIED against STRIPE_WEBHOOK_SECRET
 * via stripe.webhooks.constructEvent BEFORE any action. We read the RAW request
 * body (req.text()) — Stripe signs the exact bytes, so a parsed/re-serialized body
 * would fail verification. An unverified or malformed event is rejected with 400
 * and NEVER mutates state. We never trust the request body's contents directly.
 *
 * Graceful without keys (mirrors the other billing routes):
 *   • No STRIPE_SECRET_KEY or no STRIPE_WEBHOOK_SECRET → 503 { not_configured },
 *     NO throw, NO build dependency on env.
 *   • No DATABASE_URL → we still VERIFY the signature (200 ack so Stripe doesn't
 *     retry forever) but persist nothing — there is no Subscription table to sync.
 *
 * What we sync: customer.subscription.created/updated/deleted and
 * checkout.session.completed → upsert the workspace's Subscription row
 * (find-or-create by workspaceId, recording stripeCustomerId / stripeSubId / plan /
 * status / currentPeriodEnd). Idempotent: re-delivered events converge to the same
 * row. Unknown event types are acknowledged (200) and ignored.
 *
 * Security: the signing secret and customer ids are never logged.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // Feature-detect: without the secret key or signing secret we cannot verify —
  // refuse gracefully rather than trusting anything.
  if (!isBillingConfigured() || !isWebhookConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  // Raw body bytes — required for signature verification.
  const rawBody = await req.text();

  // ── Verify FIRST. Any failure → 400, no state change. ──────────────────────
  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET as string,
    );
  } catch (err) {
    // Do NOT log the body or secret — only that verification failed.
    const msg = err instanceof Error ? err.message : "unknown";
    console.warn(`[billing] webhook signature verification failed: ${msg}`);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  // Verified. If there's no DB, acknowledge so Stripe stops retrying, but persist
  // nothing (no Subscription table to sync to).
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ received: true, persisted: false });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    // Persistence failed AFTER successful verification — return 500 so Stripe
    // retries delivery. Log a safe message (no secrets).
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[billing] webhook handler failed for ${event.type}: ${msg}`);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true, persisted: true });
}

/** Route a verified event to the right sync. Unknown types are ignored. */
async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;
    }
    case "checkout.session.completed": {
      await syncCheckoutSession(event.data.object as Stripe.Checkout.Session);
      break;
    }
    default:
      // Acknowledged upstream; nothing to do for other event types.
      break;
  }
}

/** Resolve the customer id from a (string | object | deleted) Stripe reference. */
function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

/**
 * Map a verified Stripe Subscription onto our Subscription row. Picks the plan
 * from the first line item's price id (falling back to the subscription metadata
 * plan we set at checkout), and reads currentPeriodEnd from the item (in this API
 * version the period lives on the subscription item, not the subscription object).
 */
async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(sub.customer);
  const firstItem = sub.items?.data?.[0];

  // Plan: prefer the configured price id mapping; else the metadata we stamped at
  // checkout; else leave as-is (don't clobber to a wrong tier).
  const priceId =
    typeof firstItem?.price === "object" ? firstItem.price.id : undefined;
  const planFromPrice = priceId ? planIdForStripePrice(priceId) : null;
  const planFromMeta = readPlanMetadata(sub.metadata);
  const plan: PlanId | null = planFromPrice ?? planFromMeta;

  // current_period_end is on the subscription item in this API version.
  const periodEndUnix = firstItem?.current_period_end;
  const currentPeriodEnd =
    typeof periodEndUnix === "number" ? new Date(periodEndUnix * 1000) : null;

  // status: "canceled" for deleted subs; Stripe's status otherwise.
  const status = sub.status;

  const workspaceId = readWorkspaceId(sub.metadata);

  await upsertSubscription({
    workspaceId,
    stripeCustomerId: customerId,
    stripeSubId: sub.id,
    plan,
    status,
    currentPeriodEnd,
  });
}

/**
 * On checkout completion, link the new Stripe customer + subscription to the
 * workspace recorded in the session's client_reference_id / metadata, so the
 * portal can later resolve the customer even before subscription.* events arrive.
 */
async function syncCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode !== "subscription") return;
  const workspaceId =
    session.client_reference_id ?? readWorkspaceId(session.metadata);
  const customerId = customerIdOf(session.customer ?? null);
  const stripeSubId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? null);
  const plan = readPlanMetadata(session.metadata);

  await upsertSubscription({
    workspaceId,
    stripeCustomerId: customerId,
    stripeSubId,
    plan,
    // Checkout completion implies an active (or trialing) subscription; the
    // authoritative status arrives via the subsequent subscription.* event.
    status: "active",
    currentPeriodEnd: null,
  });
}

/** Read our workspaceId out of Stripe metadata, if present. */
function readWorkspaceId(metadata: Stripe.Metadata | null | undefined): string | null {
  const v = metadata?.workspaceId;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Read + validate our plan id out of Stripe metadata, if present. */
function readPlanMetadata(metadata: Stripe.Metadata | null | undefined): PlanId | null {
  const v = metadata?.plan;
  if (v === "free" || v === "solo" || v === "business" || v === "max") return v;
  return null;
}

/** Fields we persist for a synced subscription. */
interface SubscriptionSync {
  workspaceId: string | null;
  stripeCustomerId: string | null;
  stripeSubId: string | null;
  plan: PlanId | null;
  status: string;
  currentPeriodEnd: Date | null;
}

/**
 * Find-or-create the Subscription row and apply the synced fields. Resolution
 * order for the tenant:
 *   1. by workspaceId (from metadata / client_reference_id) — the strongest link;
 *   2. else by stripeCustomerId (an existing row already bound to this customer).
 * If neither resolves a workspace we cannot safely attribute the subscription, so
 * we skip (logged) rather than create an orphan row.
 *
 * Idempotent: re-delivered events converge to the same row; we only overwrite
 * fields we actually have (never clobber plan to null).
 */
async function upsertSubscription(sync: SubscriptionSync): Promise<void> {
  const { prisma } = await import("@/lib/db");

  let workspaceId = sync.workspaceId;

  // Fall back to resolving the workspace via an existing customer-bound row.
  if (!workspaceId && sync.stripeCustomerId) {
    const existing = await prisma.subscription.findFirst({
      where: { stripeCustomerId: sync.stripeCustomerId },
      select: { workspaceId: true },
    });
    workspaceId = existing?.workspaceId ?? null;
  }

  if (!workspaceId) {
    console.warn(
      "[billing] webhook: could not resolve a workspace for subscription sync; skipping",
    );
    return;
  }

  const data = {
    ...(sync.stripeCustomerId ? { stripeCustomerId: sync.stripeCustomerId } : {}),
    ...(sync.stripeSubId ? { stripeSubId: sync.stripeSubId } : {}),
    ...(sync.plan ? { plan: sync.plan } : {}),
    status: sync.status,
    ...(sync.currentPeriodEnd ? { currentPeriodEnd: sync.currentPeriodEnd } : {}),
  };

  // Subscription.workspaceId is @unique → upsert on it (one sub per tenant).
  await prisma.subscription.upsert({
    where: { workspaceId },
    update: data,
    create: {
      workspaceId,
      stripeCustomerId: sync.stripeCustomerId,
      stripeSubId: sync.stripeSubId,
      plan: sync.plan ?? "free",
      status: sync.status,
      currentPeriodEnd: sync.currentPeriodEnd,
    },
  });
}
