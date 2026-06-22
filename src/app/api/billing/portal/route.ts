import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspace } from "@/lib/auth";
import { getStripe, isBillingConfigured } from "@/lib/billing/stripe";
import { isDatabaseConfigured } from "@/lib/db";

/**
 * POST /api/billing/portal — open the Stripe Customer Portal for the workspace.
 *
 * Graceful without keys (mirrors the checkout route):
 *   • No STRIPE_SECRET_KEY → 503 { error: "not_configured" }, NO throw.
 *   • No DB (so no stored Stripe customer) → 503 { error: "not_configured" } —
 *     there is no customer to manage yet.
 *   • Workspace has no stripeCustomerId on file → 409 { error: "no_subscription" }.
 *
 * Security: never logs the secret key. The portal session is created for the
 * workspace's OWN Stripe customer only — resolved from our DB, never from the
 * request — so a tenant can only manage its own billing.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  if (!isBillingConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  // The portal manages an existing Stripe customer, which we persist in the
  // Subscription model — without a DB there is no customer to resolve.
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const workspace = await requireWorkspace();

  // Resolve the tenant's Stripe customer id from our own records (never trust the
  // client to supply it). Dynamic import keeps the DB off the static graph.
  const { prisma } = await import("@/lib/db");
  let customerId: string | null = null;
  try {
    const sub = await prisma.subscription.findUnique({
      where: { workspaceId: workspace.id },
      select: { stripeCustomerId: true },
    });
    customerId = sub?.stripeCustomerId ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[billing] portal customer lookup failed: ${msg}`);
    return NextResponse.json({ error: "portal_failed" }, { status: 502 });
  }

  if (!customerId) {
    return NextResponse.json({ error: "no_subscription" }, { status: 409 });
  }

  const baseUrl =
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;

  try {
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/settings/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[billing] portal session creation failed: ${msg}`);
    return NextResponse.json({ error: "portal_failed" }, { status: 502 });
  }
}
