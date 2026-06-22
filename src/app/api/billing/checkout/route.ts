import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspace } from "@/lib/auth";
import { getStripe, isBillingConfigured } from "@/lib/billing/stripe";
import { getPlan, getStripePriceId, isPlanId } from "@/lib/billing/plans";

/**
 * POST /api/billing/checkout — create a Stripe Checkout Session for a plan.
 *
 * Body: { plan: "solo" | "business" | "max" }.
 *
 * Graceful without keys (mirrors app/api/connect/[platform]/route.ts):
 *   • No STRIPE_SECRET_KEY → 503 { error: "not_configured" }, NO throw, NO build
 *     dependency on env.
 *   • Unknown / non-purchasable plan (e.g. "free") or no configured Stripe price
 *     id for the plan → 400 / 503 with a clear reason.
 * Nothing here touches the network or env at import time.
 *
 * Security: we never log the secret key. The session is bound to the caller's
 * workspace (stored in metadata + client_reference_id) so the webhook can map
 * the resulting subscription back to the tenant.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CheckoutBody {
  plan?: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  // Feature-detect: billing not configured → graceful 503, never a throw.
  if (!isBillingConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let body: CheckoutBody;
  try {
    body = (await req.json()) as CheckoutBody;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const planId = body.plan;
  if (!planId || !isPlanId(planId) || planId === "free") {
    return NextResponse.json(
      { error: "invalid_plan", detail: "plan must be one of: solo, business, max" },
      { status: 400 },
    );
  }

  const plan = getPlan(planId);
  const priceId = getStripePriceId(planId);
  if (!plan || !priceId) {
    // Plan is valid but no Stripe Price id is configured for it yet.
    return NextResponse.json(
      { error: "price_not_configured", plan: planId },
      { status: 503 },
    );
  }

  // Bind the session to the current tenant so the webhook can resolve it back.
  const workspace = await requireWorkspace();
  const baseUrl = resolveBaseUrl(req);

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      // Tie the Checkout Session (and the Subscription it creates) to our tenant.
      client_reference_id: workspace.id,
      subscription_data: {
        metadata: { workspaceId: workspace.id, plan: planId },
      },
      metadata: { workspaceId: workspace.id, plan: planId },
      allow_promotion_codes: true,
      success_url: `${baseUrl}/settings/billing?checkout=success`,
      cancel_url: `${baseUrl}/settings/billing?checkout=cancelled`,
    });

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    // Do not leak the secret key or Stripe internals; log a safe message.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[billing] checkout session creation failed: ${msg}`);
    return NextResponse.json({ error: "checkout_failed" }, { status: 502 });
  }
}

/**
 * Public base URL for success/cancel redirects. Honors a configured public base
 * (APP_URL / NEXT_PUBLIC_APP_URL) for prod; otherwise derives the origin from the
 * incoming request so dev works without extra env.
 */
function resolveBaseUrl(req: NextRequest): string {
  return (
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  );
}
