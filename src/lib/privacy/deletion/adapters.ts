import "server-only";

import type { DisconnectConnectionRecord } from "@/lib/connectors/disconnect";
import type { ProviderDeletionOutcome } from "@/lib/privacy/deletion/types";

export type StripeDeletionResult = "confirmed" | "failed" | "unavailable";
export type ClerkUserDeletionResult = "confirmed" | "failed";

export async function cancelStripeSubscriptionForDeletion(input: {
  subscriptionId: string;
  deletionRequestId: string;
}): Promise<StripeDeletionResult> {
  const { getStripe, isBillingConfigured } = await import("@/lib/billing/stripe");
  if (!isBillingConfigured()) return "unavailable";
  try {
    const subscription = await getStripe().subscriptions.cancel(
      input.subscriptionId,
      {},
      { idempotencyKey: `marpin:workspace-delete:${input.deletionRequestId}:stripe` },
    );
    return subscription.status === "canceled" ? "confirmed" : "failed";
  } catch (error) {
    // A resource already absent at Stripe cannot continue billing and is a
    // confirmed terminal outcome. No provider message is persisted or logged.
    if (
      error &&
      typeof error === "object" &&
      (("code" in error && error.code === "resource_missing") ||
        ("statusCode" in error && error.statusCode === 404))
    ) {
      return "confirmed";
    }
    return "failed";
  }
}

export async function revokeProviderGrantsForDeletion(
  connections: readonly DisconnectConnectionRecord[],
): Promise<ProviderDeletionOutcome[]> {
  const { revokeWorkspaceProviderGrants } = await import("@/lib/connectors/disconnect");
  return revokeWorkspaceProviderGrants(connections);
}

export async function deleteAssetForWorkspaceDeletion(input: {
  workspaceId: string;
  assetId: string;
  storageKey: string;
}): Promise<void> {
  const { deleteWorkspaceAssetObject } = await import("@/lib/storage/blob");
  await deleteWorkspaceAssetObject(input);
}

export async function assetStorageAvailableForDeletion(): Promise<boolean> {
  const { isAssetStorageConfigured } = await import("@/lib/storage/blob");
  return isAssetStorageConfigured();
}

export async function deletePersonalClerkUser(
  clerkUserId: string,
): Promise<ClerkUserDeletionResult> {
  if (!process.env.CLERK_SECRET_KEY) return "failed";
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    await client.users.deleteUser(clerkUserId);
    return "confirmed";
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (("status" in error && error.status === 404) ||
        ("statusCode" in error && error.statusCode === 404))
    ) {
      return "confirmed";
    }
    return "failed";
  }
}
