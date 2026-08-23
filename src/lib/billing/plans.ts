/**
 * Marpin billing plans (Stack C — Billing & metering).
 *
 * Single source of truth for launch billing. Free and Solo Founder are the only
 * self-serve plans; legacy higher tiers remain readable but hidden. Importing this
 * module touches NO env, NO network and NO DB, so it is safe in any runtime.
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

/** Legacy plan ids remain readable; only Free and Solo launch self-serve. */
export type PlanId = "free" | "solo" | "business" | "max";
export type LaunchPlanId = "free" | "solo";
export type BillingInterval = "monthly" | "annual";

/** Ordered list (Free → Max) for rendering and tier comparison. */
export const PLAN_ORDER: readonly PlanId[] = ["free", "solo", "business", "max"] as const;
export const LAUNCH_PLAN_ORDER: readonly LaunchPlanId[] = ["free", "solo"] as const;

export interface PlanEntitlements {
  maxConnections: number;
  maxBrands: number;
  maxSeats: number;
  maxScheduledPosts: number;
  storageBytes: number;
  canUseOpus: boolean;
  canExecuteActions: boolean;
}

/** Static, env-free description of a plan tier (docs/pricing-strategy.md §3). */
export interface Plan {
  id: PlanId;
  /** Human label for UI. */
  name: string;
  /** Monthly list price in EUR (informational; Stripe Price is authoritative). 0 for free. */
  priceEurMonthly: number;
  priceEurAnnual: number | null;
  /** Monthly included Marpin credits (1 credit is one standard answer). */
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
  priceEnvKeys: Partial<Record<BillingInterval, readonly string[]>>;
  /** Launch UI/checkout exposure. Business and Max are intentionally deferred. */
  launch: boolean;
  selfServe: boolean;
  entitlements: PlanEntitlements;
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
    priceEurAnnual: null,
    includedCredits: 25,
    overageEurPerCredit: null, // upgrade to unlock top-ups
    priceEnvKeys: {},
    launch: true,
    selfServe: false,
    entitlements: {
      maxConnections: 1,
      maxBrands: 1,
      maxSeats: 1,
      maxScheduledPosts: 10,
      storageBytes: 250 * 1024 * 1024,
      canUseOpus: false,
      canExecuteActions: false,
    },
  },
  solo: {
    id: "solo",
    name: "Solo Founder",
    priceEurMonthly: 39.99,
    priceEurAnnual: 399,
    includedCredits: 120,
    overageEurPerCredit: 0.3,
    priceEnvKeys: {
      monthly: ["STRIPE_PRICE_SOLO_MONTHLY", "STRIPE_PRICE_SOLO"],
      annual: ["STRIPE_PRICE_SOLO_ANNUAL"],
    },
    launch: true,
    selfServe: true,
    entitlements: {
      maxConnections: 4,
      maxBrands: 1,
      maxSeats: 1,
      maxScheduledPosts: 100,
      storageBytes: 5 * 1024 * 1024 * 1024,
      canUseOpus: true,
      canExecuteActions: true,
    },
  },
  business: {
    id: "business",
    name: "Business",
    priceEurMonthly: 149,
    priceEurAnnual: 1490,
    includedCredits: 600,
    overageEurPerCredit: 0.2,
    priceEnvKeys: { monthly: ["STRIPE_PRICE_BUSINESS"] },
    launch: false,
    selfServe: false,
    entitlements: {
      maxConnections: 12,
      maxBrands: 5,
      maxSeats: 5,
      maxScheduledPosts: 1_000,
      storageBytes: 50 * 1024 * 1024 * 1024,
      canUseOpus: true,
      canExecuteActions: true,
    },
  },
  max: {
    id: "max",
    name: "Max / Enterprise",
    priceEurMonthly: 599,
    priceEurAnnual: null,
    includedCredits: 3000,
    overageEurPerCredit: 0.15,
    priceEnvKeys: { monthly: ["STRIPE_PRICE_MAX"] },
    launch: false,
    selfServe: false,
    entitlements: {
      maxConnections: Number.MAX_SAFE_INTEGER,
      maxBrands: Number.MAX_SAFE_INTEGER,
      maxSeats: Number.MAX_SAFE_INTEGER,
      maxScheduledPosts: Number.MAX_SAFE_INTEGER,
      storageBytes: Number.MAX_SAFE_INTEGER,
      canUseOpus: true,
      canExecuteActions: true,
    },
  },
};

/** Narrow an arbitrary string to a known PlanId, or null. */
export function isPlanId(value: string): value is PlanId {
  return value === "free" || value === "solo" || value === "business" || value === "max";
}

export function isLaunchPlanId(value: string): value is LaunchPlanId {
  return value === "free" || value === "solo";
}

export function isBillingInterval(value: string): value is BillingInterval {
  return value === "monthly" || value === "annual";
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
export function getStripePriceId(
  id: PlanId,
  interval: BillingInterval = "monthly",
): string | null {
  for (const key of PLANS[id].priceEnvKeys[interval] ?? []) {
    const value = process.env[key];
    if (value) return value;
  }
  return null;
}

/**
 * Reverse lookup: which PlanId does a given Stripe Price id correspond to?
 * Used by the webhook to map a subscription's price back onto our plan tiers.
 * Returns null when the price id matches no configured plan. Lazy (reads env).
 */
export function planIdForStripePrice(priceId: string): PlanId | null {
  for (const id of PLAN_ORDER) {
    if (id === "free") continue;
    if (getStripePriceId(id, "monthly") === priceId) return id;
    if (getStripePriceId(id, "annual") === priceId) return id;
  }
  return null;
}

export function billingIntervalForStripePrice(priceId: string): BillingInterval | null {
  for (const id of PLAN_ORDER) {
    if (getStripePriceId(id, "monthly") === priceId) return "monthly";
    if (getStripePriceId(id, "annual") === priceId) return "annual";
  }
  return null;
}

/** Monthly included credits for a plan tier (defaults to free's allowance). */
export function includedCreditsFor(id: string): number {
  return getPlan(id)?.includedCredits ?? PLANS.free.includedCredits;
}
