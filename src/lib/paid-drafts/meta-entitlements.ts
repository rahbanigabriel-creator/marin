import { resolveWorkspaceBillingPolicy, type BillingDatabase } from "@/lib/billing/entitlements";
import { EntitlementDeniedError } from "@/lib/billing/errors";
import { prisma } from "@/lib/db";

export async function requireMetaCreationEntitlement(workspaceId: string, db: BillingDatabase = prisma, now = new Date()): Promise<void> {
  const policy = await resolveWorkspaceBillingPolicy(workspaceId, db, now);
  if (!policy.entitlements.canExecuteActions) {
    throw new EntitlementDeniedError("actions_not_in_plan", "paid_campaign_creation", "Creating campaigns in Meta requires an active Solo plan or trial. You can still edit and export your draft.");
  }
}
