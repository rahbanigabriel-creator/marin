import type { WorkspaceRole } from "@/lib/auth";
import type {
  AgentApprovalBinding,
  AgentApprovalCheck,
  AgentApprovalKind,
  AgentToolPolicy,
} from "@/lib/agent-runs/types";

export function canInvokeAgentTool(input: {
  policy: AgentToolPolicy;
  role: WorkspaceRole;
  entitlements: ReadonlySet<string>;
  callsUsed: number;
}): boolean {
  if (!input.policy.roles.includes(input.role)) return false;
  if (input.policy.entitlement && !input.entitlements.has(input.policy.entitlement)) return false;
  if (!Number.isSafeInteger(input.callsUsed) || input.callsUsed < 0) return false;
  return input.callsUsed < input.policy.maxCalls;
}

export function requiresHumanApproval(
  policy: Pick<AgentToolPolicy, "risk">,
): boolean {
  return policy.risk === "external" || policy.risk === "spend";
}

export function checkAgentApproval(input: {
  approval: AgentApprovalBinding;
  kind: AgentApprovalKind;
  objectType: string;
  objectId: string;
  objectVersion: number;
  snapshotHash: string;
  accountId: string | null;
  now: Date;
}): AgentApprovalCheck {
  if (input.approval.kind !== input.kind) return { allowed: false, reason: "wrong_kind" };
  if (input.approval.objectType !== input.objectType || input.approval.objectId !== input.objectId) {
    return { allowed: false, reason: "wrong_object" };
  }
  if (input.approval.objectVersion !== input.objectVersion) return { allowed: false, reason: "wrong_version" };
  if (input.approval.snapshotHash !== input.snapshotHash) return { allowed: false, reason: "wrong_snapshot" };
  if (input.approval.accountId !== input.accountId) return { allowed: false, reason: "wrong_account" };
  const expiresAt = new Date(input.approval.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= input.now.getTime()) {
    return { allowed: false, reason: "expired" };
  }
  return { allowed: true, reason: "approved" };
}
