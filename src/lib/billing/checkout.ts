import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";

import { prisma } from "@/lib/db";

const LOCAL_TERMINAL_STATUSES = new Set(["inactive", "canceled", "incomplete_expired"]);
const STRIPE_TERMINAL_STATUSES = new Set<Stripe.Subscription.Status>([
  "canceled",
  "incomplete_expired",
]);

export interface SubscriptionConflictPayload {
  error: "subscription_exists";
  code: "subscription_exists";
  message: string;
  manageUrl: "/settings/billing";
  subscriptionStatus: string;
}

export interface CheckoutConflictPayload {
  error: "checkout_in_progress";
  code: "checkout_in_progress";
  message: string;
  checkoutUrl?: string;
  sessionId: string;
}

export class WorkspaceCheckoutLockError extends Error {
  constructor() {
    super("Workspace not found during checkout");
    this.name = "WorkspaceCheckoutLockError";
  }
}

/**
 * Serialize all checkout admission and creation work for one workspace. Stripe
 * calls intentionally remain inside this transaction: releasing the row before
 * Session creation would reopen the exact monthly/annual race this lock closes.
 */
export async function withWorkspaceCheckoutLock<T>(
  workspaceId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const lockedWorkspace = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "workspaces"
        WHERE "id" = ${workspaceId}
        FOR UPDATE
      `;
      if (lockedWorkspace.length !== 1) throw new WorkspaceCheckoutLockError();
      return operation(tx);
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}

/**
 * Local billing state fails closed. Only explicit terminal/no-subscription
 * states may enter a new checkout while Stripe reconciliation catches delayed
 * webhooks for otherwise Free-looking rows.
 */
export function isBlockingLocalSubscriptionStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return !LOCAL_TERMINAL_STATUSES.has(status.trim().toLowerCase());
}

export function isNonterminalStripeSubscriptionStatus(
  status: Stripe.Subscription.Status,
): boolean {
  return !STRIPE_TERMINAL_STATUSES.has(status);
}

export function isOpenSubscriptionCheckout(
  session: Pick<Stripe.Checkout.Session, "mode" | "status">,
): boolean {
  return session.status === "open" && session.mode === "subscription";
}

export function subscriptionConflictPayload(status: string): SubscriptionConflictPayload {
  return {
    error: "subscription_exists",
    code: "subscription_exists",
    message: "This workspace already has a subscription that must be managed before starting another checkout.",
    manageUrl: "/settings/billing",
    subscriptionStatus: status,
  };
}

export function checkoutConflictPayload(
  session: Pick<Stripe.Checkout.Session, "id" | "url">,
): CheckoutConflictPayload {
  return {
    error: "checkout_in_progress",
    code: "checkout_in_progress",
    message: "A subscription checkout is already open for this workspace.",
    ...(session.url ? { checkoutUrl: session.url } : {}),
    sessionId: session.id,
  };
}
