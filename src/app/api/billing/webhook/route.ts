import { NextResponse } from "next/server";
import type Stripe from "stripe";

import {
  getStripe,
  isBillingConfigured,
  isWebhookConfigured,
} from "@/lib/billing/stripe";
import { processVerifiedStripeEvent } from "@/lib/billing/webhook";
import { isDatabaseConfigured } from "@/lib/db";
import {
  readBoundedText,
  requestBodyErrorResponse,
  STRIPE_WEBHOOK_BODY_LIMIT_BYTES,
} from "@/lib/security/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!isBillingConfigured() || !isWebhookConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  let rawBody: string;
  try {
    rawBody = await readBoundedText(req, STRIPE_WEBHOOK_BODY_LIMIT_BYTES);
  } catch (error) {
    const bodyFailure = requestBodyErrorResponse(error);
    if (bodyFailure) return bodyFailure;
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET as string,
    );
  } catch {
    console.warn("[billing] webhook signature verification failed");
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  if (!isDatabaseConfigured()) {
    // A 2xx response tells Stripe the delivery is permanently consumed. Fail
    // retryably while persistence is unavailable so entitlement state catches up.
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }

  try {
    const result = await processVerifiedStripeEvent(event);
    return NextResponse.json({ received: true, persisted: true, ...result });
  } catch {
    console.error(`[billing] webhook handler failed for ${event.type}`);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
