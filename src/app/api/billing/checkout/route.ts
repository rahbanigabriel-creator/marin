import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspaceRole,
} from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import {
  checkoutConflictPayload,
  isBlockingLocalSubscriptionStatus,
  isNonterminalStripeSubscriptionStatus,
  isOpenSubscriptionCheckout,
  subscriptionConflictPayload,
  withWorkspaceCheckoutLock,
  type CheckoutConflictPayload,
  type SubscriptionConflictPayload,
} from "@/lib/billing/checkout";
import {
  getStripePriceId,
  isBillingInterval,
  type BillingInterval,
} from "@/lib/billing/plans";
import { getStripe, isBillingConfigured } from "@/lib/billing/stripe";
import { isDatabaseConfigured } from "@/lib/db";
import {
  readBoundedJson,
  requestBodyErrorResponse,
} from "@/lib/security/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CheckoutBody {
  plan?: string;
  interval?: string;
}

type CheckoutOutcome =
  | { kind: "created"; sessionId: string; url: string }
  | { kind: "subscription_conflict"; payload: SubscriptionConflictPayload }
  | { kind: "checkout_conflict"; payload: CheckoutConflictPayload };

function baseUrl(req: NextRequest): string {
  return process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
}

function accessFailure(error: unknown): NextResponse | null {
  const seatLimit = workspaceSeatLimitResponse(error);
  if (seatLimit) return seatLimit;
  if (error instanceof NotAuthenticatedError) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (error instanceof WorkspaceAuthorizationError) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export async function POST(req: NextRequest): Promise<Response> {
  let access;
  try {
    access = await requireWorkspaceRole(["owner", "admin"]);
  } catch (error) {
    const response = accessFailure(error);
    if (response) return response;
    throw error;
  }
  if (!isBillingConfigured() || !isDatabaseConfigured() || access.workspace.isDev) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let body: CheckoutBody;
  try {
    body = await readBoundedJson<CheckoutBody>(req, 4 * 1024);
  } catch (error) {
    const bodyFailure = requestBodyErrorResponse(error);
    if (bodyFailure) return bodyFailure;
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (body.plan !== "solo") {
    return NextResponse.json({ error: "invalid_plan", detail: "Only Solo Founder is self-serve." }, { status: 400 });
  }
  const interval: BillingInterval = body.interval && isBillingInterval(body.interval)
    ? body.interval
    : "annual";
  const priceId = getStripePriceId("solo", interval);
  if (!priceId) {
    return NextResponse.json({ error: "price_not_configured", interval }, { status: 503 });
  }

  try {
    const stripe = getStripe();
    const outcome = await withWorkspaceCheckoutLock<CheckoutOutcome>(
      access.workspace.id,
      async (tx) => {
        const existing = await tx.subscription.findUnique({
          where: { workspaceId: access.workspace.id },
        });
        if (isBlockingLocalSubscriptionStatus(existing?.status)) {
          return {
            kind: "subscription_conflict",
            payload: subscriptionConflictPayload(existing!.status),
          };
        }

        let customerId = existing?.stripeCustomerId ?? null;
        if (!customerId) {
          const customer = await stripe.customers.create(
            {
              description: `Marpin workspace ${access.workspace.name}`,
              metadata: { workspaceId: access.workspace.id },
            },
            { idempotencyKey: `marpin:customer:${access.workspace.id}` },
          );
          customerId = customer.id;
          await tx.subscription.upsert({
            where: { workspaceId: access.workspace.id },
            update: { stripeCustomerId: customerId },
            create: {
              workspaceId: access.workspace.id,
              stripeCustomerId: customerId,
              plan: "free",
              status: "inactive",
            },
          });
        }

        for await (const subscription of stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 100,
        })) {
          if (isNonterminalStripeSubscriptionStatus(subscription.status)) {
            return {
              kind: "subscription_conflict",
              payload: subscriptionConflictPayload(subscription.status),
            };
          }
        }

        for await (const session of stripe.checkout.sessions.list({
          customer: customerId,
          status: "open",
          limit: 100,
        })) {
          if (isOpenSubscriptionCheckout(session)) {
            return {
              kind: "checkout_conflict",
              payload: checkoutConflictPayload(session),
            };
          }
        }

        const session = await stripe.checkout.sessions.create(
          {
            mode: "subscription",
            customer: customerId,
            customer_update: { address: "auto", name: "auto" },
            line_items: [{ price: priceId, quantity: 1 }],
            client_reference_id: access.workspace.id,
            subscription_data: {
              metadata: { workspaceId: access.workspace.id, plan: "solo", interval },
            },
            metadata: { workspaceId: access.workspace.id, plan: "solo", interval },
            allow_promotion_codes: true,
            success_url: `${baseUrl(req)}/settings/billing?checkout=success`,
            cancel_url: `${baseUrl(req)}/settings/billing?checkout=cancelled`,
          },
          {
            idempotencyKey: `marpin:checkout:${access.workspace.id}:${randomUUID()}`,
          },
        );
        if (!session.url) throw new Error("Checkout URL missing");
        return { kind: "created", sessionId: session.id, url: session.url };
      },
    );

    if (outcome.kind === "subscription_conflict" || outcome.kind === "checkout_conflict") {
      return NextResponse.json(outcome.payload, { status: 409 });
    }
    return NextResponse.json({ url: outcome.url, sessionId: outcome.sessionId });
  } catch (error) {
    console.error("[billing] checkout session creation failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "checkout_failed" }, { status: 502 });
  }
}
