import type { Prisma } from "@prisma/client";

import type {
  AgentApprovalDecision,
  AgentApprovalBinding,
  AgentApprovalKind,
  AgentRunDispatchStatus,
  AgentRunLimits,
  AgentRunMode,
  AgentRunStatus,
  AgentStepStatus,
  AgentToolRisk,
} from "@/lib/agent-runs/types";

export const agentRunInclude = {
  steps: { orderBy: [{ ordinal: "asc" as const }] },
  events: { orderBy: [{ sequence: "asc" as const }] },
  approvals: { orderBy: [{ decidedAt: "asc" as const }] },
} satisfies Prisma.AgentRunInclude;

export type AgentRunRow = Prisma.AgentRunGetPayload<{
  include: typeof agentRunInclude;
}>;

export interface AgentRunStepDto {
  id: string;
  ordinal: number;
  attempt: number;
  toolName: string;
  risk: AgentToolRisk;
  status: AgentStepStatus;
  approvalBinding: AgentApprovalBinding | null;
  output: {
    objectType: string;
    objectId: string;
    objectVersion: number | null;
    snapshotHash: string | null;
  } | null;
  error: { code: string; message: string | null } | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AgentRunEventDto {
  id: string;
  sequence: number;
  type: string;
  label: string;
  detail: string | null;
  objectType: string | null;
  objectId: string | null;
  evidenceIds: string[];
  createdAt: string;
}

export interface AgentRunApprovalDto {
  id: string;
  stepId: string;
  decision: AgentApprovalDecision;
  kind: AgentApprovalKind;
  objectType: string;
  objectId: string;
  objectVersion: number;
  snapshotHash: string;
  accountId: string | null;
  expiresAt: string;
  decidedAt: string;
}

export interface AgentRunDto {
  id: string;
  brandId: string;
  conversationId: string | null;
  mode: AgentRunMode;
  goal: string;
  planKey: string;
  target: AgentApprovalBinding | null;
  status: AgentRunStatus;
  dispatchStatus: AgentRunDispatchStatus;
  dispatchErrorCode: string | null;
  limits: AgentRunLimits;
  usage: {
    steps: number;
    toolCalls: number;
    modelTurns: number;
    webReads: number;
    credits: number;
  };
  attempt: number;
  version: number;
  failure: { code: string; message: string | null } | null;
  deadlineAt: string;
  cancelRequestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  steps: AgentRunStepDto[];
  events: AgentRunEventDto[];
  approvals: AgentRunApprovalDto[];
}

function evidenceIds(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 20)
    : [];
}

function exactBinding(value: Prisma.JsonValue | null): AgentApprovalBinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.kind !== "string" ||
    typeof row.objectType !== "string" ||
    typeof row.objectId !== "string" ||
    !Number.isSafeInteger(row.objectVersion) ||
    typeof row.snapshotHash !== "string" ||
    (row.accountId !== null && typeof row.accountId !== "string") ||
    typeof row.expiresAt !== "string"
  ) return null;
  return row as unknown as AgentApprovalBinding;
}

export function toAgentRunDto(row: AgentRunRow): AgentRunDto {
  return {
    id: row.id,
    brandId: row.brandId,
    conversationId: row.conversationId,
    mode: row.mode as AgentRunMode,
    goal: row.goal,
    planKey: row.planKey,
    target: exactBinding(row.target),
    status: row.status as AgentRunStatus,
    dispatchStatus: row.dispatchStatus as AgentRunDispatchStatus,
    dispatchErrorCode: row.dispatchErrorCode,
    limits: row.limits as unknown as AgentRunLimits,
    usage: {
      steps: row.stepsUsed,
      toolCalls: row.toolCallsUsed,
      modelTurns: row.modelTurnsUsed,
      webReads: row.webReadsUsed,
      credits: row.creditsUsed,
    },
    attempt: row.attempt,
    version: row.version,
    failure: row.failureCode
      ? { code: row.failureCode, message: row.failureMessage }
      : null,
    deadlineAt: row.deadlineAt.toISOString(),
    cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    steps: row.steps.map((step) => ({
      id: step.id,
      ordinal: step.ordinal,
      attempt: step.attempt,
      toolName: step.toolName,
      risk: step.risk as AgentToolRisk,
      status: step.status as AgentStepStatus,
      approvalBinding: exactBinding(step.approvalBinding),
      output:
        step.outputObjectType && step.outputObjectId
          ? {
              objectType: step.outputObjectType,
              objectId: step.outputObjectId,
              objectVersion: step.outputObjectVersion,
              snapshotHash: step.outputSnapshotHash,
            }
          : null,
      error: step.errorCode
        ? { code: step.errorCode, message: step.errorMessage }
        : null,
      createdAt: step.createdAt.toISOString(),
      completedAt: step.completedAt?.toISOString() ?? null,
    })),
    events: row.events.map((event) => ({
      id: event.id,
      sequence: event.sequence,
      type: event.type,
      label: event.label,
      detail: event.detail,
      objectType: event.objectType,
      objectId: event.objectId,
      evidenceIds: evidenceIds(event.evidenceIds),
      createdAt: event.createdAt.toISOString(),
    })),
    approvals: row.approvals.map((approval) => ({
      id: approval.id,
      stepId: approval.stepId,
      decision: approval.decision as AgentApprovalDecision,
      kind: approval.kind as AgentApprovalKind,
      objectType: approval.objectType,
      objectId: approval.objectId,
      objectVersion: approval.objectVersion,
      snapshotHash: approval.snapshotHash,
      accountId: approval.accountId,
      expiresAt: approval.expiresAt.toISOString(),
      decidedAt: approval.decidedAt.toISOString(),
    })),
  };
}
