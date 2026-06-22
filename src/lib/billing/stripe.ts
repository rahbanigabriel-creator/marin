import "server-only";

import Stripe from "stripe";

/**
 * Stripe client lifecycle + billing gating (Stack C — Billing & metering).
 * Server-only.
 *
 * Graceful without keys (mirrors src/lib/agent/provider.ts and src/lib/db.ts):
 *   • Importing this module NEVER constructs a client or touches the network.
 *   • getStripe() lazily creates the client at first use, and ONLY when
 *     STRIPE_SECRET_KEY is present. With no key, callers feature-detect via
 *     isBillingConfigured() and return a graceful 503 — nothing throws at
 *     import/build, so `next build` / `tsc --noEmit` stay green with no env.
 *
 * EU data residency: Stripe is a global processor; data residency is configured
 * at the Stripe account level (EU). No region/host is hardcoded here. The SDK's
 * default API host is used; the pinned API version comes from the installed SDK.
 *
 * Security: the secret key and webhook secret are read lazily from env and are
 * NEVER logged. The webhook secret is consumed only by constructEvent (signature
 * verification) in the webhook route — never trusted from request bodies.
 */

/** Thrown when a billing operation is attempted with no STRIPE_SECRET_KEY. */
export class BillingNotConfiguredError extends Error {
  constructor() {
    super("STRIPE_SECRET_KEY is not set — billing is not configured");
    this.name = "BillingNotConfiguredError";
  }
}

/**
 * True when Stripe is configured for API calls (secret key present). Read lazily
 * from env on every call — never at import — so the gate reflects the runtime
 * environment. Gate every checkout/portal/webrite path on this.
 */
export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * True when inbound webhooks can be verified (signing secret present). The
 * webhook route refuses to act unless this is true AND the signature checks out,
 * so unverified events are never trusted.
 */
export function isWebhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

let client: Stripe | null = null;

/**
 * Lazily resolve the Stripe client, constructing it at most once. Throws
 * BillingNotConfiguredError when STRIPE_SECRET_KEY is absent — callers should
 * gate with isBillingConfigured() first and return a 503 instead.
 *
 * We intentionally do NOT pin `apiVersion`: the installed SDK's types only model
 * its own pinned version, so omitting it keeps types strict + correct and avoids
 * a brittle literal that would drift on upgrade.
 */
export function getStripe(): Stripe {
  if (!isBillingConfigured()) throw new BillingNotConfiguredError();
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
      // Identify this integration in Stripe's request logs (no secrets here).
      appInfo: { name: "Marin", url: "https://marin.app" },
      typescript: true,
    });
  }
  return client;
}
