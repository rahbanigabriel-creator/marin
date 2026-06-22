/**
 * Marin billing plans (Stack C — Billing & metering).
 *
 * Single source of truth for the four pricing tiers from docs/pricing-strategy.md
 * (§3). Pure data + lookups: importing this module touches NO env, NO network and
 * NO DB, so it is safe in any runtime (server, edge, client) and `next build` /
 * `tsc --noEmit` stay green with no keys.
 *
 * Stripe price IDs are NOT baked in here — they are read LAZILY from env per plan
 * (mirrors the graceful-without-keys pattern in src/lib/agent/provider.ts and
 * src/lib/db.ts). A plan with no configured price id simply isn't checkout-able;
 * the billing routes degrade to a graceful 503 rather than throwing.
 *
 * Pricing is EUR (the doc prices in €); amounts here are informational metadata —
 * the authoritative price a customer is charged always lives in the Stripe Price
 * object referenced by the price id, never in this file.
 */

/** The four plan tiers. Matches Subscription.plan in prisma/schema.prisma. */
export type PlanId = "free" | "solo" | "business" | "max";

/** Ordered list (Free → Max) for rendering and tier comparison. */
export const PLAN_ORDER: readonly PlanId[] = ["free", "solo", "business", "max"] as const;

/** Static, env-free description of a plan tier (docs/pricing-strategy.md §3). */
export interface Plan {
  id: PlanId;
  /** Human label for UI. */
  name: string;
  /** Monthly list price in EUR (informational; Stripe Price is authoritative). 0 for free. */
  priceEurMonthly: number;
  /** Monthly included Marin credits (1 credit ≈ 1 standard answer). */
  includedCredits: number;
  /**
   * Overage / top-up rate in EUR per extra credit beyond the included allowance,
   * or null for plans with no self-serve top-up (free → must upgrade). Cheaper as
   * you climb (the upgrade incentive). See pricing-strategy.md §3 "Top-up €/credit".
   */
  overageEurPerCredit: number | null;
  /**
   * Env var name holding this plan's Stripe Price id. Read lazily (never at import)
   * so the build is env-independent. Free has no Stripe price (null).
   */
  priceEnvKey: string | null;
}

/**
 * The plan catalog. Credits + prices are taken verbatim from the pricing doc:
 *   Free 25 · Solo €39.99 / 120 · Business €149 / 600 · Max €599 / 3000.
 * Top-up €/credit: Solo €0.30 · Business €0.20 · Max €0.15 (Free: upgrade to unlock).
 */
export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceEurMonthly: 0,
    includedCredits: 25,
    overageEurPerCredit: null, // upgrade to unlock top-ups
    priceEnvKey: null, // no Stripe price for the free tier
  },
  solo: {
    id: "solo",
    name: "Solo Founder",
    priceEurMonthly: 39.99,
    includedCredits: 120,
    overageEurPerCredit: 0.3,
    priceEnvKey: "STRIPE_PRICE_SOLO",
  },
  business: {
    id: "business",
    name: "Business",
    priceEurMonthly: 149,
    includedCredits: 600,
    overageEurPerCredit: 0.2,
    priceEnvKey: "STRIPE_PRICE_BUSINESS",
  },
  max: {
    id: "max",
    name: "Max / Enterprise",
    priceEurMonthly: 599,
    includedCredits: 3000,
    overageEurPerCredit: 0.15,
    priceEnvKey: "STRIPE_PRICE_MAX",
  },
};

/** Narrow an arbitrary string to a known PlanId, or null. */
export function isPlanId(value: string): value is PlanId {
  return value === "free" || value === "solo" || value === "business" || value === "max";
}

/** Look up a plan by id, or undefined for an unknown id. */
export function getPlan(id: string): Plan | undefined {
  return isPlanId(id) ? PLANS[id] : undefined;
}

/**
 * Resolve a plan's configured Stripe Price id from env, or null when unset.
 * Read lazily on every call — never at import — so the build never depends on
 * these being present. The free plan (no priceEnvKey) always returns null.
 */
export function getStripePriceId(id: PlanId): string | null {
  const key = PLANS[id].priceEnvKey;
  if (!key) return null;
  const value = process.env[key];
  return value && value.length > 0 ? value : null;
}

/**
 * Reverse lookup: which PlanId does a given Stripe Price id correspond to?
 * Used by the webhook to map a subscription's price back onto our plan tiers.
 * Returns null when the price id matches no configured plan. Lazy (reads env).
 */
export function planIdForStripePrice(priceId: string): PlanId | null {
  for (const id of PLAN_ORDER) {
    if (id === "free") continue;
    if (getStripePriceId(id) === priceId) return id;
  }
  return null;
}

/** Monthly included credits for a plan tier (defaults to free's allowance). */
export function includedCreditsFor(id: string): number {
  return getPlan(id)?.includedCredits ?? PLANS.free.includedCredits;
}
