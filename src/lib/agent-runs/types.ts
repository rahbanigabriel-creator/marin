import type { WorkspaceRole } from "@/lib/auth";

export const AGENT_RUN_MODES = [
  "assistant",
  "organic",
  "seo",
  "paid",
  "influencers",
] as const;
export type AgentRunMode = (typeof AGENT_RUN_MODES)[number];

export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_input"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentRunDispatchStatus =
  | "pending"
  | "sent"
  | "unavailable";

export type AgentStepStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "outcome_unknown";

export type AgentToolRisk = "read" | "internal_write" | "external" | "spend";

export const AGENT_APPROVAL_KINDS = [
  "publish",
  "external_handoff",
  "outreach_send",
  "paid_create_paused",
  "paid_activate",
  "paid_budget_change",
] as const;
export type AgentApprovalKind = (typeof AGENT_APPROVAL_KINDS)[number];

export interface AgentRunLimits {
  maxSteps: number;
  maxToolCalls: number;
  maxModelTurns: number;
  maxWebReads: number;
  maxCredits: number;
}

export interface AgentRunRequest {
  brandId: string;
  conversationId: string | null;
  goal: string;
  mode: AgentRunMode;
  requestId: string;
  target: AgentRunTargetRequest | null;
}

export interface AgentRunTargetRequest {
  kind: "paid_create_paused" | "paid_activate";
  objectId: string;
}

export interface AgentRunListQuery {
  status: AgentRunStatus | null;
  brandId: string | null;
  limit: number;
}

export type AgentApprovalDecision = "accepted" | "rejected";

export interface AgentRunCommandRequest {
  requestId: string;
}

export interface AgentApprovalDecisionRequest extends AgentRunCommandRequest {
  decision: AgentApprovalDecision;
  stepId: string;
  kind: AgentApprovalKind;
  objectType: string;
  objectId: string;
  objectVersion: number;
  snapshotHash: string;
  accountId: string | null;
}

export interface AgentToolPolicy {
  name: string;
  risk: AgentToolRisk;
  roles: readonly WorkspaceRole[];
  entitlement: string | null;
  maxCalls: number;
}

export interface AgentApprovalBinding {
  kind: AgentApprovalKind;
  objectType: string;
  objectId: string;
  objectVersion: number;
  snapshotHash: string;
  accountId: string | null;
  expiresAt: string;
}

export interface AgentApprovalCheck {
  allowed: boolean;
  reason:
    | "approved"
    | "wrong_kind"
    | "wrong_object"
    | "wrong_version"
    | "wrong_snapshot"
    | "wrong_account"
    | "expired";
}

export const AGENT_PUBLIC_EVENT_TYPES = [
  "run_queued",
  "run_started",
  "object_created",
  "object_updated",
  "evidence_observed",
  "approval_required",
  "input_required",
  "step_succeeded",
  "run_succeeded",
  "run_failed",
  "run_cancelled",
] as const;
export type AgentPublicEventType = (typeof AGENT_PUBLIC_EVENT_TYPES)[number];

export interface AgentPublicEvent {
  type: AgentPublicEventType;
  label: string;
  detail: string | null;
  objectType: string | null;
  objectId: string | null;
  evidenceIds: string[];
}

export interface AgentContextSnapshot {
  brandId: string;
  contextVersion: number;
  mode: AgentRunMode;
  timezone: string;
  facts: Array<{
    key: string;
    value: string;
    source: string;
    observedAt: string | null;
    verificationStatus: "verified" | "attested" | "unverified";
  }>;
  recentTurns: Array<{ role: "user" | "assistant"; content: string }>;
}
