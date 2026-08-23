import { Prisma } from "@prisma/client";

import type { WorkspaceRole } from "@/lib/auth";
import { WorkspaceAuthorizationError } from "@/lib/auth";
import { checkAgentApproval } from "@/lib/agent-runs/capabilities";
import { agentRunInclude, toAgentRunDto, type AgentRunDto } from "@/lib/agent-runs/dto";
import {
  AgentRunConflictError,
  AgentRunEntitlementError,
  AgentRunNotFoundError,
} from "@/lib/agent-runs/errors";
import { agentSnapshotHash } from "@/lib/agent-runs/hash";
import { appendAgentRunEvent, lockAgentRun } from "@/lib/agent-runs/persistence";
import { agentPlanForRequest } from "@/lib/agent-runs/registry";
import type {
  AgentApprovalBinding,
  AgentApprovalDecisionRequest,
  AgentRunCommandRequest,
  AgentRunListQuery,
  AgentRunRequest,
} from "@/lib/agent-runs/types";
import { boundedRunLimits } from "@/lib/agent-runs/validation";
import { resolveWorkspaceBillingPolicy } from "@/lib/billing/entitlements";
import { prisma } from "@/lib/db";

const RUN_DEADLINE_MS = 15 * 60 * 1_000;
const MAX_ATTEMPTS = 3;

export interface AgentRunMutationResult {
  run: AgentRunDto;
  replayed: boolean;
}

function requireManager(role: WorkspaceRole): void {
  if (role !== "owner" && role !== "admin") {
    throw new WorkspaceAuthorizationError();
  }
}

async function requireEntitlement(
  workspaceId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  const policy = await resolveWorkspaceBillingPolicy(workspaceId, db);
  if (!policy.entitlements.canExecuteActions) throw new AgentRunEntitlementError();
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function findRun(
  workspaceId: string,
  runId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const run = await db.agentRun.findFirst({
    where: { id: runId, workspaceId },
    include: agentRunInclude,
  });
  if (!run) throw new AgentRunNotFoundError();
  return run;
}

async function replayCreate(
  workspaceId: string,
  requestId: string,
  requestHash: string,
): Promise<AgentRunMutationResult | null> {
  const existing = await prisma.agentRun.findUnique({
    where: { workspaceId_requestId: { workspaceId, requestId } },
    include: agentRunInclude,
  });
  if (!existing) return null;
  if (existing.requestHash !== requestHash) {
    throw new AgentRunConflictError(
      "request_conflict",
      "This requestId is already bound to a different agent run",
      existing.version,
    );
  }
  return { run: toAgentRunDto(existing), replayed: true };
}

async function replayCommand(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    runId: string;
    requestId: string;
    requestHash: string;
    kind: string;
  },
): Promise<AgentRunMutationResult | null> {
  const command = await tx.agentRunCommand.findUnique({
    where: {
      workspaceId_requestId: {
        workspaceId: input.workspaceId,
        requestId: input.requestId,
      },
    },
  });
  if (!command) return null;
  if (
    command.runId !== input.runId ||
    command.requestHash !== input.requestHash ||
    command.kind !== input.kind
  ) {
    throw new AgentRunConflictError(
      "request_conflict",
      "This requestId is already bound to a different agent command",
    );
  }
  const run = await findRun(input.workspaceId, input.runId, tx);
  return { run: toAgentRunDto(run), replayed: true };
}

async function recordCommand(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    runId: string;
    requestId: string;
    requestHash: string;
    kind: string;
    resultStatus: string;
    resultVersion: number;
    actorId: string;
  },
): Promise<void> {
  await tx.agentRunCommand.create({ data: input });
}

export async function createAgentRun(input: {
  workspaceId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  request: AgentRunRequest;
  now?: Date;
}): Promise<AgentRunMutationResult> {
  requireManager(input.actorRole);
  await requireEntitlement(input.workspaceId);
  const limits = boundedRunLimits();
  const requestHash = agentSnapshotHash(input.request);
  const replay = await replayCreate(input.workspaceId, input.request.requestId, requestHash);
  if (replay) return replay;
  const now = input.now ?? new Date();
  const plan = agentPlanForRequest(input.request.mode, Boolean(input.request.target));

  try {
    const runId = await prisma.$transaction(async (tx) => {
      const brand = await tx.brand.findFirst({
        where: { id: input.request.brandId, workspaceId: input.workspaceId },
        select: { id: true },
      });
      if (!brand) throw new AgentRunNotFoundError();
      if (input.request.conversationId) {
        const conversation = await tx.conversation.findFirst({
          where: {
            id: input.request.conversationId,
            workspaceId: input.workspaceId,
            brandId: brand.id,
          },
          select: { id: true },
        });
        if (!conversation) throw new AgentRunNotFoundError();
      }
      let target: Prisma.InputJsonValue | undefined;
      if (input.request.target) {
        const draft = await tx.paidCampaignDraft.findFirst({
          where: { id: input.request.target.objectId, workspaceId: input.workspaceId },
          select: {
            id: true,
            state: true,
            version: true,
            snapshotHash: true,
            accountId: true,
          },
        });
        if (!draft) throw new AgentRunNotFoundError();
        const expectedState =
          input.request.target.kind === "paid_create_paused"
            ? "ready"
            : "provider_paused";
        if (draft.state !== expectedState) {
          throw new AgentRunConflictError(
            "target_state_conflict",
            "The paid draft is not in the required state for this operation",
            draft.version,
          );
        }
        target = {
          kind: input.request.target.kind,
          objectType: "paid_campaign_draft",
          objectId: draft.id,
          objectVersion: draft.version,
          snapshotHash: draft.snapshotHash,
          accountId: draft.accountId,
          expiresAt: new Date(now.getTime() + 10 * 60 * 1_000).toISOString(),
        };
      }
      const run = await tx.agentRun.create({
        data: {
          workspaceId: input.workspaceId,
          brandId: brand.id,
          conversationId: input.request.conversationId,
          requestId: input.request.requestId,
          requestHash,
          mode: input.request.mode,
          goal: input.request.goal,
          planKey: plan.key,
          target,
          limits: {
            maxSteps: limits.maxSteps,
            maxToolCalls: limits.maxToolCalls,
            maxModelTurns: limits.maxModelTurns,
            maxWebReads: limits.maxWebReads,
            maxCredits: limits.maxCredits,
          },
          deadlineAt: new Date(now.getTime() + RUN_DEADLINE_MS),
          createdBy: input.actorId,
        },
        select: { id: true },
      });
      await appendAgentRunEvent(tx, {
        workspaceId: input.workspaceId,
        runId: run.id,
        eventKey: "run:queued:1",
        event: {
          type: "run_queued",
          label: "Agent run queued",
          detail: "Waiting for the bounded worker",
        },
      });
      return run.id;
    });
    return { run: toAgentRunDto(await findRun(input.workspaceId, runId)), replayed: false };
  } catch (error) {
    if (isUniqueConflict(error)) {
      const raced = await replayCreate(input.workspaceId, input.request.requestId, requestHash);
      if (raced) return raced;
    }
    throw error;
  }
}

export async function listAgentRuns(input: {
  workspaceId: string;
  query: AgentRunListQuery;
}): Promise<AgentRunDto[]> {
  const rows = await prisma.agentRun.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(input.query.status ? { status: input.query.status } : {}),
      ...(input.query.brandId ? { brandId: input.query.brandId } : {}),
    },
    include: agentRunInclude,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: input.query.limit,
  });
  return rows.map(toAgentRunDto);
}

export async function getAgentRun(input: {
  workspaceId: string;
  runId: string;
}): Promise<AgentRunDto> {
  return toAgentRunDto(await findRun(input.workspaceId, input.runId));
}

export async function cancelAgentRun(input: {
  workspaceId: string;
  runId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  command: AgentRunCommandRequest;
  now?: Date;
}): Promise<AgentRunMutationResult> {
  requireManager(input.actorRole);
  const requestHash = agentSnapshotHash({
    kind: "cancel",
    runId: input.runId,
    requestId: input.command.requestId,
  });
  return prisma.$transaction(async (tx) => {
    await lockAgentRun(tx, input.workspaceId, input.runId);
    const replay = await replayCommand(tx, {
      workspaceId: input.workspaceId,
      runId: input.runId,
      requestId: input.command.requestId,
      requestHash,
      kind: "cancel",
    });
    if (replay) return replay;
    const current = await findRun(input.workspaceId, input.runId, tx);
    if (current.status === "succeeded") {
      throw new AgentRunConflictError(
        "run_terminal",
        "A succeeded run cannot be cancelled",
        current.version,
      );
    }
    const now = input.now ?? new Date();
    const immediately = current.status !== "running";
    const updated = await tx.agentRun.update({
      where: { id: current.id },
      data: {
        cancelRequestedAt: current.cancelRequestedAt ?? now,
        ...(immediately
          ? { status: "cancelled", completedAt: current.completedAt ?? now }
          : {}),
        version: { increment: 1 },
      },
    });
    if (immediately) {
      await appendAgentRunEvent(tx, {
        workspaceId: input.workspaceId,
        runId: input.runId,
        eventKey: `run:cancelled:${updated.version}`,
        event: { type: "run_cancelled", label: "Agent run cancelled" },
      });
    }
    await recordCommand(tx, {
      workspaceId: input.workspaceId,
      runId: input.runId,
      requestId: input.command.requestId,
      requestHash,
      kind: "cancel",
      resultStatus: updated.status,
      resultVersion: updated.version,
      actorId: input.actorId,
    });
    return {
      run: toAgentRunDto(await findRun(input.workspaceId, input.runId, tx)),
      replayed: false,
    };
  });
}

export async function retryAgentRun(input: {
  workspaceId: string;
  runId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  command: AgentRunCommandRequest;
  now?: Date;
}): Promise<AgentRunMutationResult> {
  requireManager(input.actorRole);
  await requireEntitlement(input.workspaceId);
  const requestHash = agentSnapshotHash({
    kind: "retry",
    runId: input.runId,
    requestId: input.command.requestId,
  });
  return prisma.$transaction(async (tx) => {
    await lockAgentRun(tx, input.workspaceId, input.runId);
    const replay = await replayCommand(tx, {
      workspaceId: input.workspaceId,
      runId: input.runId,
      requestId: input.command.requestId,
      requestHash,
      kind: "retry",
    });
    if (replay) return replay;
    const current = await findRun(input.workspaceId, input.runId, tx);
    const dispatchRetry =
      current.status === "queued" && current.dispatchStatus === "unavailable";
    if (current.status !== "failed" && !dispatchRetry) {
      throw new AgentRunConflictError(
        "run_not_retryable",
        "Only failed or dispatch-unavailable runs can be retried",
        current.version,
      );
    }
    if (!dispatchRetry && current.attempt >= MAX_ATTEMPTS) {
      throw new AgentRunConflictError(
        "retry_limit_reached",
        "The agent run retry limit has been reached",
        current.version,
      );
    }
    const now = input.now ?? new Date();
    const updated = await tx.agentRun.update({
      where: { id: current.id },
      data: {
        status: "queued",
        dispatchStatus: "pending",
        dispatchErrorCode: null,
        failureCode: null,
        failureMessage: null,
        completedAt: null,
        cancelRequestedAt: null,
        deadlineAt: new Date(now.getTime() + RUN_DEADLINE_MS),
        ...(!dispatchRetry ? { attempt: { increment: 1 } } : {}),
        version: { increment: 1 },
      },
    });
    await appendAgentRunEvent(tx, {
      workspaceId: input.workspaceId,
      runId: input.runId,
      eventKey: `run:queued:${updated.version}`,
      event: { type: "run_queued", label: "Agent run retry queued" },
    });
    await recordCommand(tx, {
      workspaceId: input.workspaceId,
      runId: input.runId,
      requestId: input.command.requestId,
      requestHash,
      kind: "retry",
      resultStatus: updated.status,
      resultVersion: updated.version,
      actorId: input.actorId,
    });
    return {
      run: toAgentRunDto(await findRun(input.workspaceId, input.runId, tx)),
      replayed: false,
    };
  });
}

function approvalBinding(value: Prisma.JsonValue | null): AgentApprovalBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentRunConflictError("approval_not_pending", "This step has no approval request");
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.kind !== "string" ||
    typeof row.objectType !== "string" ||
    typeof row.objectId !== "string" ||
    !Number.isSafeInteger(row.objectVersion) ||
    typeof row.snapshotHash !== "string" ||
    (row.accountId !== null && typeof row.accountId !== "string") ||
    typeof row.expiresAt !== "string"
  ) {
    throw new AgentRunConflictError("approval_not_pending", "This step has no valid approval request");
  }
  return row as unknown as AgentApprovalBinding;
}

export async function decideAgentRunApproval(input: {
  workspaceId: string;
  runId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  decision: AgentApprovalDecisionRequest;
  now?: Date;
}): Promise<AgentRunMutationResult> {
  requireManager(input.actorRole);
  if (input.decision.decision === "accepted") await requireEntitlement(input.workspaceId);
  const requestHash = agentSnapshotHash({
    runId: input.runId,
    ...input.decision,
  });
  return prisma.$transaction(async (tx) => {
    await lockAgentRun(tx, input.workspaceId, input.runId);
    const replay = await replayCommand(tx, {
      workspaceId: input.workspaceId,
      runId: input.runId,
      requestId: input.decision.requestId,
      requestHash,
      kind: `approval_${input.decision.decision}`,
    });
    if (replay) return replay;
    const run = await findRun(input.workspaceId, input.runId, tx);
    if (run.status !== "waiting_approval") {
      throw new AgentRunConflictError(
        "approval_not_pending",
        "This run is not waiting for approval",
        run.version,
      );
    }
    const step = await tx.agentRunStep.findFirst({
      where: {
        id: input.decision.stepId,
        runId: input.runId,
        workspaceId: input.workspaceId,
        status: "waiting_approval",
      },
    });
    if (!step) throw new AgentRunNotFoundError();
    const existingDecision = await tx.agentRunApproval.findUnique({
      where: { stepId: step.id },
    });
    if (existingDecision) {
      throw new AgentRunConflictError("approval_already_decided", "This approval was already decided", run.version);
    }
    const binding = approvalBinding(step.approvalBinding);
    const now = input.now ?? new Date();
    const check = checkAgentApproval({
      approval: binding,
      kind: input.decision.kind,
      objectType: input.decision.objectType,
      objectId: input.decision.objectId,
      objectVersion: input.decision.objectVersion,
      snapshotHash: input.decision.snapshotHash,
      accountId: input.decision.accountId,
      now,
    });
    if (!check.allowed && !(input.decision.decision === "rejected" && check.reason === "expired")) {
      throw new AgentRunConflictError(
        `approval_${check.reason}`,
        "The approval no longer matches the exact requested operation",
        run.version,
      );
    }
    if (input.decision.decision === "accepted") {
      if (binding.objectType !== "paid_campaign_draft") {
        throw new AgentRunConflictError(
          "approval_object_unsupported",
          "This approval object does not have a reviewed server resolver",
          run.version,
        );
      }
      const currentObject = await tx.paidCampaignDraft.findFirst({
        where: { id: binding.objectId, workspaceId: input.workspaceId },
        select: {
          version: true,
          snapshotHash: true,
          accountId: true,
          state: true,
        },
      });
      if (!currentObject) throw new AgentRunNotFoundError();
      const expectedState = binding.kind === "paid_activate" ? "provider_paused" : "ready";
      if (
        currentObject.version !== binding.objectVersion ||
        currentObject.snapshotHash !== binding.snapshotHash ||
        currentObject.accountId !== binding.accountId ||
        currentObject.state !== expectedState
      ) {
        throw new AgentRunConflictError(
          "approval_stale",
          "The paid draft changed after this approval was requested",
          run.version,
        );
      }
    }
    await tx.agentRunApproval.create({
      data: {
        workspaceId: input.workspaceId,
        runId: input.runId,
        stepId: step.id,
        requestId: input.decision.requestId,
        requestHash,
        decision: input.decision.decision,
        kind: binding.kind,
        objectType: binding.objectType,
        objectId: binding.objectId,
        objectVersion: binding.objectVersion,
        snapshotHash: binding.snapshotHash,
        accountId: binding.accountId,
        expiresAt: new Date(binding.expiresAt),
        decidedBy: input.actorId,
        decidedAt: now,
      },
    });
    const accepted = input.decision.decision === "accepted";
    const updated = await tx.agentRun.update({
      where: { id: run.id },
      data: {
        status: accepted ? "queued" : "cancelled",
        dispatchStatus: accepted ? "pending" : run.dispatchStatus,
        completedAt: accepted ? null : now,
        deadlineAt: accepted
          ? new Date(now.getTime() + RUN_DEADLINE_MS)
          : run.deadlineAt,
        version: { increment: 1 },
      },
    });
    await appendAgentRunEvent(tx, {
      workspaceId: input.workspaceId,
      runId: input.runId,
      eventKey: `approval:${step.id}:${input.decision.decision}`,
      event: accepted
        ? { type: "run_queued", label: "Approval accepted; run queued" }
        : { type: "run_cancelled", label: "Approval rejected; run cancelled" },
    });
    await recordCommand(tx, {
      workspaceId: input.workspaceId,
      runId: input.runId,
      requestId: input.decision.requestId,
      requestHash,
      kind: `approval_${input.decision.decision}`,
      resultStatus: updated.status,
      resultVersion: updated.version,
      actorId: input.actorId,
    });
    return {
      run: toAgentRunDto(await findRun(input.workspaceId, input.runId, tx)),
      replayed: false,
    };
  });
}

export async function updateAgentRunDispatch(input: {
  workspaceId: string;
  runId: string;
  status: "sent" | "unavailable";
  errorCode: string | null;
}): Promise<AgentRunDto> {
  await prisma.agentRun.updateMany({
    where: {
      id: input.runId,
      workspaceId: input.workspaceId,
      status: "queued",
    },
    data: {
      dispatchStatus: input.status,
      dispatchErrorCode: input.errorCode,
    },
  });
  return toAgentRunDto(await findRun(input.workspaceId, input.runId));
}
