import type { Prisma } from "@prisma/client";

import type { WorkspaceRole } from "@/lib/auth";
import { canInvokeAgentTool, requiresHumanApproval } from "@/lib/agent-runs/capabilities";
import { agentSnapshotHash, agentToolIdempotencyKey } from "@/lib/agent-runs/hash";
import {
  analyzePaidMonitor,
  exactPaidMonitorBinding,
  isRecentPaidMonitorWindow,
  paidMonitorWindow,
} from "@/lib/agent-runs/paid-monitor";
import { appendAgentRunEvent, lockAgentRun } from "@/lib/agent-runs/persistence";
import { agentPlanByKey } from "@/lib/agent-runs/registry";
import type { AgentApprovalBinding, AgentRunLimits, AgentRunStatus } from "@/lib/agent-runs/types";
import { boundedRunLimits } from "@/lib/agent-runs/validation";
import { resolveWorkspaceBillingPolicy } from "@/lib/billing/entitlements";
import { prisma } from "@/lib/db";
import { calendarDateKey } from "@/lib/time/zoned";

export interface AgentCoordinatorResult {
  ran: boolean;
  status: AgentRunStatus | "missing";
  reason?: string;
}

function asLimits(value: Prisma.JsonValue): AgentRunLimits {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return boundedRunLimits();
  }
  return boundedRunLimits(value as Partial<AgentRunLimits>);
}

function addCalendarDays(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function exactApprovalBinding(value: Prisma.JsonValue | null): AgentApprovalBinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.kind !== "string" ||
    typeof row.objectType !== "string" ||
    typeof row.objectId !== "string" ||
    !Number.isSafeInteger(row.objectVersion) ||
    typeof row.snapshotHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.snapshotHash) ||
    (row.accountId !== null && typeof row.accountId !== "string") ||
    typeof row.expiresAt !== "string"
  ) return null;
  return row as unknown as AgentApprovalBinding;
}

async function failRun(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    runId: string;
    attempt: number;
    code: string;
    message: string;
    now: Date;
    toolName?: string;
    risk?: string;
    inputHash?: string;
  },
): Promise<AgentCoordinatorResult> {
  const current = await tx.agentRun.findFirst({
    where: { id: input.runId, workspaceId: input.workspaceId },
    select: { stepsUsed: true, version: true },
  });
  if (!current) return { ran: false, status: "missing" };
  const ordinal = current.stepsUsed + 1;
  if (input.toolName && input.risk && input.inputHash) {
    await tx.agentRunStep.create({
      data: {
        workspaceId: input.workspaceId,
        runId: input.runId,
        ordinal,
        attempt: input.attempt,
        toolName: input.toolName,
        risk: input.risk,
        status: "failed",
        idempotencyKey: agentToolIdempotencyKey({
          runId: input.runId,
          ordinal,
          toolName: input.toolName,
        }),
        inputHash: input.inputHash,
        errorCode: input.code,
        errorMessage: input.message,
        completedAt: input.now,
      },
    });
  }
  const updated = await tx.agentRun.update({
    where: { id: input.runId },
    data: {
      status: "failed",
      failureCode: input.code,
      failureMessage: input.message,
      completedAt: input.now,
      ...(input.toolName ? { stepsUsed: { increment: 1 } } : {}),
      version: { increment: 1 },
    },
  });
  await appendAgentRunEvent(tx, {
    workspaceId: input.workspaceId,
    runId: input.runId,
    eventKey: `run:failed:${updated.version}`,
    event: {
      type: "run_failed",
      label: "Agent run stopped safely",
      detail: input.message,
    },
  });
  return { ran: true, status: "failed", reason: input.code };
}

async function executeLockedAgentRun(input: {
  workspaceId: string;
  runId: string;
  now: Date;
}): Promise<AgentCoordinatorResult> {
  return prisma.$transaction(async (tx) => {
    await lockAgentRun(tx, input.workspaceId, input.runId);
    const run = await tx.agentRun.findFirst({
      where: { id: input.runId, workspaceId: input.workspaceId },
      include: { brand: { select: { timezone: true } } },
    });
    if (!run) return { ran: false, status: "missing" };
    if (["succeeded", "failed", "cancelled"].includes(run.status)) {
      return { ran: false, status: run.status as AgentRunStatus, reason: "terminal" };
    }
    if (run.status === "waiting_input" || run.status === "waiting_approval") {
      return { ran: false, status: run.status as AgentRunStatus, reason: "waiting" };
    }
    if (run.cancelRequestedAt) {
      const updated = await tx.agentRun.update({
        where: { id: run.id },
        data: {
          status: "cancelled",
          completedAt: input.now,
          version: { increment: 1 },
        },
      });
      await appendAgentRunEvent(tx, {
        workspaceId: input.workspaceId,
        runId: run.id,
        eventKey: `run:cancelled:${updated.version}`,
        event: { type: "run_cancelled", label: "Agent run cancelled" },
      });
      return { ran: true, status: "cancelled" };
    }
    if (run.deadlineAt.getTime() <= input.now.getTime()) {
      return failRun(tx, {
        workspaceId: input.workspaceId,
        runId: run.id,
        attempt: run.attempt,
        code: "deadline_exceeded",
        message: "The bounded agent deadline expired",
        now: input.now,
      });
    }

    const plan = agentPlanByKey(run.planKey);
    if (!plan || plan.mode !== run.mode) {
      return failRun(tx, {
        workspaceId: input.workspaceId,
        runId: run.id,
        attempt: run.attempt,
        code: "plan_unavailable",
        message: "The reviewed agent plan is unavailable",
        now: input.now,
      });
    }
    const inputHash = agentSnapshotHash({
      runId: run.id,
      attempt: run.attempt,
      planKey: plan.key,
      brandId: run.brandId,
      goal: run.goal,
      target: run.target,
    });
    const limits = asLimits(run.limits);
    if (run.stepsUsed >= limits.maxSteps || run.toolCallsUsed >= limits.maxToolCalls) {
      return failRun(tx, {
        workspaceId: input.workspaceId,
        runId: run.id,
        attempt: run.attempt,
        code: "limit_reached",
        message: "The bounded agent limit was reached",
        now: input.now,
      });
    }

    const membership = await tx.membership.findUnique({
      where: {
        workspaceId_clerkUserId: {
          workspaceId: input.workspaceId,
          clerkUserId: run.createdBy,
        },
      },
      select: { role: true },
    });
    const role = membership?.role as WorkspaceRole | undefined;
    const policy = await resolveWorkspaceBillingPolicy(input.workspaceId, tx);
    const entitlements = new Set<string>();
    if (policy.entitlements.canExecuteActions) entitlements.add("canExecuteActions");
    if (
      !role ||
      !canInvokeAgentTool({
        policy: plan.tool,
        role,
        entitlements,
        // A paid approval replay performs no second tool call: it only records
        // the honest assisted-handoff state after the immutable decision.
        callsUsed:
          plan.behavior === "request_paid_approval" && run.toolCallsUsed === 1
            ? 0
            : run.toolCallsUsed,
      })
    ) {
      return failRun(tx, {
        workspaceId: input.workspaceId,
        runId: run.id,
        attempt: run.attempt,
        code: "capability_denied",
        message: "The current role or plan no longer permits this agent tool",
        now: input.now,
        toolName: plan.tool.name,
        risk: plan.tool.risk,
        inputHash,
      });
    }
    if (plan.behavior === "request_paid_approval") {
      const binding = exactApprovalBinding(run.target);
      if (!binding || new Date(binding.expiresAt).getTime() <= input.now.getTime()) {
        return failRun(tx, {
          workspaceId: input.workspaceId,
          runId: run.id,
          attempt: run.attempt,
          code: "approval_binding_invalid",
          message: "The exact paid operation approval binding is missing or expired",
          now: input.now,
          toolName: plan.tool.name,
          risk: plan.tool.risk,
          inputHash,
        });
      }
      const accepted = await tx.agentRunApproval.findFirst({
        where: {
          runId: run.id,
          workspaceId: input.workspaceId,
          decision: "accepted",
          kind: binding.kind,
          objectType: binding.objectType,
          objectId: binding.objectId,
          objectVersion: binding.objectVersion,
          snapshotHash: binding.snapshotHash,
          accountId: binding.accountId,
        },
        select: { id: true },
      });
      if (accepted) {
        if (binding.objectType !== "paid_campaign_draft") {
          return failRun(tx, {
            workspaceId: input.workspaceId,
            runId: run.id,
            attempt: run.attempt,
            code: "approval_object_unsupported",
            message: "The approved object has no reviewed server resolver",
            now: input.now,
          });
        }
        const currentObject = await tx.paidCampaignDraft.findFirst({
          where: { id: binding.objectId, workspaceId: input.workspaceId },
          select: { version: true, snapshotHash: true, accountId: true, state: true },
        });
        const expectedState = binding.kind === "paid_activate" ? "provider_paused" : "ready";
        if (
          !currentObject ||
          currentObject.version !== binding.objectVersion ||
          currentObject.snapshotHash !== binding.snapshotHash ||
          currentObject.accountId !== binding.accountId ||
          currentObject.state !== expectedState
        ) {
          return failRun(tx, {
            workspaceId: input.workspaceId,
            runId: run.id,
            attempt: run.attempt,
            code: "approval_stale",
            message: "The approved paid draft changed before handoff",
            now: input.now,
          });
        }
        const updated = await tx.agentRun.update({
          where: { id: run.id },
          data: {
            status: "waiting_input",
            version: { increment: 1 },
          },
        });
        await appendAgentRunEvent(tx, {
          workspaceId: input.workspaceId,
          runId: run.id,
          eventKey: `run:handoff:${updated.version}`,
          event: {
            type: "input_required",
            label: "Approval recorded; provider execution unavailable",
            detail: "Use the reviewed assisted handoff; no provider success was recorded",
            objectType: binding.objectType,
            objectId: binding.objectId,
          },
        });
        return { ran: true, status: "waiting_input", reason: "assisted_handoff_required" };
      }
      const ordinal = run.stepsUsed + 1;
      await tx.agentRunStep.create({
        data: {
          workspaceId: input.workspaceId,
          runId: run.id,
          ordinal,
          attempt: run.attempt,
          toolName: plan.tool.name,
          risk: plan.tool.risk,
          status: "waiting_approval",
          idempotencyKey: agentToolIdempotencyKey({
            runId: run.id,
            ordinal,
            toolName: plan.tool.name,
          }),
          inputHash,
          approvalBinding: binding as unknown as Prisma.InputJsonValue,
        },
      });
      const updated = await tx.agentRun.update({
        where: { id: run.id },
        data: {
          status: "waiting_approval",
          stepsUsed: { increment: 1 },
          toolCallsUsed: { increment: 1 },
          version: { increment: 1 },
        },
      });
      await appendAgentRunEvent(tx, {
        workspaceId: input.workspaceId,
        runId: run.id,
        eventKey: `run:approval:${updated.version}`,
        event: {
          type: "approval_required",
          label: "Exact paid operation approval required",
          detail: "Review the stored draft version and account before continuing",
          objectType: binding.objectType,
          objectId: binding.objectId,
        },
      });
      return { ran: true, status: "waiting_approval" };
    }
    if (requiresHumanApproval(plan.tool)) {
      return failRun(tx, {
        workspaceId: input.workspaceId,
        runId: run.id,
        attempt: run.attempt,
        code: "approval_binding_missing",
        message: "External work requires an exact human approval binding",
        now: input.now,
        toolName: plan.tool.name,
        risk: plan.tool.risk,
        inputHash,
      });
    }

    if (!run.startedAt) {
      await tx.agentRun.update({
        where: { id: run.id },
        data: {
          status: "running",
          startedAt: input.now,
          dispatchStatus: "sent",
          dispatchErrorCode: null,
          version: { increment: 1 },
        },
      });
      await appendAgentRunEvent(tx, {
        workspaceId: input.workspaceId,
        runId: run.id,
        eventKey: `run:started:${run.attempt}`,
        event: { type: "run_started", label: "Agent run started" },
      });
    }

    const ordinal = run.stepsUsed + 1;
    const stepKey = agentToolIdempotencyKey({
      runId: run.id,
      ordinal,
      toolName: plan.tool.name,
    });

    if (plan.behavior === "monitor_paid_campaigns") {
      const binding = exactPaidMonitorBinding(run.target);
      const window = binding ? paidMonitorWindow(binding) : null;
      if (!binding || !window || !isRecentPaidMonitorWindow(window, input.now)) {
        return failRun(tx, {
          workspaceId: input.workspaceId,
          runId: run.id,
          attempt: run.attempt,
          code: "monitor_binding_invalid",
          message: "The exact paid account or recent monitoring window is no longer valid",
          now: input.now,
          toolName: plan.tool.name,
          risk: plan.tool.risk,
          inputHash,
        });
      }

      const connection = await tx.connection.findFirst({
        where: {
          id: binding.connectionId,
          workspaceId: input.workspaceId,
          status: "connected",
          platform: binding.platform,
          externalAccountId: binding.accountId,
        },
        select: {
          id: true,
          platform: true,
          externalAccountId: true,
          displayName: true,
          currency: true,
          timezone: true,
          lastSuccessfulSyncAt: true,
        },
      });
      if (!connection) {
        return failRun(tx, {
          workspaceId: input.workspaceId,
          runId: run.id,
          attempt: run.attempt,
          code: "monitor_connection_unavailable",
          message: "The selected paid account is no longer actively connected",
          now: input.now,
          toolName: plan.tool.name,
          risk: plan.tool.risk,
          inputHash,
        });
      }

      // Keep this plan provider-isolated: only canonical persisted paid data is read.
      const [attempts, facts, campaigns] = await Promise.all([
        tx.syncAttempt.findMany({
          where: { workspaceId: input.workspaceId, connectionId: connection.id },
          select: {
            id: true,
            status: true,
            requestedFrom: true,
            requestedTo: true,
            observedFrom: true,
            observedTo: true,
            startedAt: true,
            completedAt: true,
          },
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          take: 50,
        }),
        tx.metricFact.findMany({
          where: {
            workspaceId: input.workspaceId,
            connectionId: connection.id,
            platform: binding.platform,
            staleAt: null,
            date: { gte: window.from, lte: window.to },
            metric: {
              in: ["spend", "revenue", "conversions", "clicks", "impressions"],
            },
          },
          select: {
            id: true,
            date: true,
            campaignExternalId: true,
            campaignName: true,
            metric: true,
            value: true,
            currency: true,
          },
          orderBy: [{ date: "asc" }, { id: "asc" }],
          take: 20_001,
        }),
        tx.campaign.findMany({
          where: {
            workspaceId: input.workspaceId,
            connectionId: connection.id,
            platform: binding.platform,
            staleAt: null,
          },
          select: {
            id: true,
            providerExternalId: true,
            name: true,
            status: true,
            objective: true,
            budget: true,
            currency: true,
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: 501,
        }),
      ]);
      if (facts.length > 20_000 || campaigns.length > 500) {
        return failRun(tx, {
          workspaceId: input.workspaceId,
          runId: run.id,
          attempt: run.attempt,
          code: "monitor_data_limit",
          message: "The persisted paid dataset exceeds this bounded monitor run",
          now: input.now,
          toolName: plan.tool.name,
          risk: plan.tool.risk,
          inputHash,
        });
      }

      const latestAttempt = attempts[0] ?? null;
      const latestUsableAttempt =
        attempts.find((attempt) => attempt.status === "succeeded" || attempt.status === "partial") ?? null;
      const report = analyzePaidMonitor({
        now: input.now,
        window,
        connection: {
          id: connection.id,
          platform: binding.platform,
          accountId: connection.externalAccountId,
          accountName: connection.displayName ?? connection.externalAccountId,
          currency: connection.currency,
          timezone: connection.timezone,
          lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
        },
        latestAttempt,
        latestUsableAttempt,
        facts,
        campaigns,
      });
      const outputHash = agentSnapshotHash(report);
      await tx.agentRunStep.create({
        data: {
          workspaceId: input.workspaceId,
          runId: run.id,
          ordinal,
          attempt: run.attempt,
          toolName: plan.tool.name,
          risk: plan.tool.risk,
          status: "succeeded",
          idempotencyKey: stepKey,
          inputHash,
          outputObjectType: "paid_monitor_report",
          outputObjectId: run.id,
          outputObjectVersion: run.attempt,
          outputSnapshotHash: outputHash,
          completedAt: input.now,
        },
      });
      await appendAgentRunEvent(tx, {
        workspaceId: input.workspaceId,
        runId: run.id,
        eventKey: `monitor:source:${run.attempt}`,
        event: {
          type: "evidence_observed",
          label: "Persisted paid source inspected",
          detail: `Read ${report.summary.factCount} canonical metric facts and ${report.summary.campaignCount} campaign records for ${binding.from} to ${binding.to}. Source observed through ${report.source.observedTo ?? "an unavailable timestamp"}; sync recorded ${report.source.syncedAt ?? "at an unavailable timestamp"}.`,
          objectType: "connection",
          objectId: connection.id,
          evidenceIds: report.source.evidenceIds,
        },
      });
      for (const [index, finding] of report.findings.entries()) {
        await appendAgentRunEvent(tx, {
          workspaceId: input.workspaceId,
          runId: run.id,
          eventKey: `monitor:finding:${run.attempt}:${index + 1}`,
          event: {
            type: "evidence_observed",
            label: `${finding.kind === "alert" ? "Alert" : "Recommendation"}: ${finding.label}`,
            detail: finding.detail,
            objectType: finding.objectType,
            objectId: finding.objectId,
            evidenceIds: finding.evidenceIds,
          },
        });
      }
      const updated = await tx.agentRun.update({
        where: { id: run.id },
        data: {
          status: "succeeded",
          stepsUsed: { increment: 1 },
          toolCallsUsed: { increment: 1 },
          completedAt: input.now,
          failureCode: null,
          failureMessage: null,
          version: { increment: 1 },
        },
      });
      await appendAgentRunEvent(tx, {
        workspaceId: input.workspaceId,
        runId: run.id,
        eventKey: `monitor:completed:${run.attempt}`,
        event: {
          type: "step_succeeded",
          label: "One-time paid campaign monitor completed",
          detail: `${report.summary.alerts} alerts and ${report.summary.recommendations} recommendations were recorded. Read-only analysis completed; no provider request was made.`,
          objectType: "paid_monitor_report",
          objectId: run.id,
          evidenceIds: report.source.evidenceIds,
        },
      });
      await appendAgentRunEvent(tx, {
        workspaceId: input.workspaceId,
        runId: run.id,
        eventKey: `run:succeeded:${updated.version}`,
        event: {
          type: "run_succeeded",
          label: "Agent run completed",
          detail: "This was a one-time check; no recurring monitor was scheduled.",
        },
      });
      return { ran: true, status: "succeeded" };
    }

    if (plan.behavior === "request_input") {
      await tx.agentRunStep.create({
        data: {
          workspaceId: input.workspaceId,
          runId: run.id,
          ordinal,
          attempt: run.attempt,
          toolName: plan.tool.name,
          risk: plan.tool.risk,
          status: "succeeded",
          idempotencyKey: stepKey,
          inputHash,
          completedAt: input.now,
        },
      });
      const updated = await tx.agentRun.update({
        where: { id: run.id },
        data: {
          status: "waiting_input",
          stepsUsed: { increment: 1 },
          toolCallsUsed: { increment: 1 },
          version: { increment: 1 },
        },
      });
      await appendAgentRunEvent(tx, {
        workspaceId: input.workspaceId,
        runId: run.id,
        eventKey: `run:input:${updated.version}`,
        event: {
          type: "input_required",
          label: "More structured input is required",
          detail: "Create a new run with the exact object or workflow details",
        },
      });
      return { ran: true, status: "waiting_input" };
    }

    const startKey = calendarDateKey(input.now, run.brand.timezone);
    const endKey = addCalendarDays(startKey, 6);
    const contentPlan = await tx.contentPlan.create({
      data: {
        workspaceId: input.workspaceId,
        brandId: run.brandId,
        name: "Weekly organic plan",
        objective: run.goal,
        status: "draft",
        startDate: new Date(`${startKey}T00:00:00.000Z`),
        endDate: new Date(`${endKey}T23:59:59.999Z`),
        timezone: run.brand.timezone,
        strategy: {
          period: "week",
          source: "agent",
          agentRunId: run.id,
          planKey: plan.key,
        },
        createdBy: run.createdBy,
      },
    });
    const outputHash = agentSnapshotHash({
      id: contentPlan.id,
      version: contentPlan.version,
      brandId: contentPlan.brandId,
      startDate: contentPlan.startDate.toISOString(),
      endDate: contentPlan.endDate.toISOString(),
      status: contentPlan.status,
    });
    await tx.agentRunStep.create({
      data: {
        workspaceId: input.workspaceId,
        runId: run.id,
        ordinal,
        attempt: run.attempt,
        toolName: plan.tool.name,
        risk: plan.tool.risk,
        status: "succeeded",
        idempotencyKey: stepKey,
        inputHash,
        outputObjectType: "content_plan",
        outputObjectId: contentPlan.id,
        outputObjectVersion: contentPlan.version,
        outputSnapshotHash: outputHash,
        completedAt: input.now,
      },
    });
    const updated = await tx.agentRun.update({
      where: { id: run.id },
      data: {
        status: "succeeded",
        stepsUsed: { increment: 1 },
        toolCallsUsed: { increment: 1 },
        completedAt: input.now,
        failureCode: null,
        failureMessage: null,
        version: { increment: 1 },
      },
    });
    await appendAgentRunEvent(tx, {
      workspaceId: input.workspaceId,
      runId: run.id,
      eventKey: `object:content_plan:${contentPlan.id}`,
      event: {
        type: "object_created",
        label: "Created weekly organic plan",
        detail: "A seven-day draft plan is ready for manual or AI editing",
        objectType: "content_plan",
        objectId: contentPlan.id,
      },
    });
    await appendAgentRunEvent(tx, {
      workspaceId: input.workspaceId,
      runId: run.id,
      eventKey: `run:succeeded:${updated.version}`,
      event: { type: "run_succeeded", label: "Agent run completed" },
    });
    return { ran: true, status: "succeeded" };
  });
}

export async function executeAgentRun(input: {
  workspaceId: string;
  runId: string;
  now?: Date;
}): Promise<AgentCoordinatorResult> {
  const now = input.now ?? new Date();
  try {
    return await executeLockedAgentRun({ ...input, now });
  } catch {
    return prisma.$transaction(async (tx) => {
      await lockAgentRun(tx, input.workspaceId, input.runId);
      const run = await tx.agentRun.findFirst({
        where: { id: input.runId, workspaceId: input.workspaceId },
        select: { status: true, attempt: true },
      });
      if (!run) return { ran: false, status: "missing" };
      if (["succeeded", "failed", "cancelled"].includes(run.status)) {
        return { ran: false, status: run.status as AgentRunStatus, reason: "terminal" };
      }
      return failRun(tx, {
        workspaceId: input.workspaceId,
        runId: input.runId,
        attempt: run.attempt,
        code: "internal_tool_failed",
        message: "The reviewed internal tool could not complete",
        now,
      });
    });
  }
}

/** Bounded outage reconciler: no nonterminal run can remain past its deadline. */
export async function reconcileExpiredAgentRuns(
  now = new Date(),
  take = 100,
): Promise<{ scanned: number; reconciled: number }> {
  const boundedTake = Math.max(1, Math.min(Math.trunc(take), 250));
  const candidates = await prisma.agentRun.findMany({
    where: {
      status: { in: ["queued", "running", "waiting_input", "waiting_approval"] },
      deadlineAt: { lte: now },
    },
    select: { id: true, workspaceId: true },
    orderBy: [{ deadlineAt: "asc" }, { id: "asc" }],
    take: boundedTake,
  });
  let reconciled = 0;
  for (const candidate of candidates) {
    const changed = await prisma.$transaction(async (tx) => {
      await lockAgentRun(tx, candidate.workspaceId, candidate.id);
      const run = await tx.agentRun.findFirst({
        where: { id: candidate.id, workspaceId: candidate.workspaceId },
        select: {
          status: true,
          deadlineAt: true,
          cancelRequestedAt: true,
          version: true,
        },
      });
      if (
        !run ||
        !["queued", "running", "waiting_input", "waiting_approval"].includes(run.status) ||
        run.deadlineAt.getTime() > now.getTime()
      ) return false;
      const cancelled = Boolean(run.cancelRequestedAt);
      const updated = await tx.agentRun.update({
        where: { id: candidate.id },
        data: {
          status: cancelled ? "cancelled" : "failed",
          completedAt: now,
          ...(!cancelled
            ? {
                failureCode: "deadline_exceeded",
                failureMessage: "The bounded agent deadline expired",
              }
            : {}),
          version: { increment: 1 },
        },
      });
      await appendAgentRunEvent(tx, {
        workspaceId: candidate.workspaceId,
        runId: candidate.id,
        eventKey: cancelled
          ? `run:cancelled:${updated.version}`
          : `run:failed:${updated.version}`,
        event: cancelled
          ? { type: "run_cancelled", label: "Agent run cancelled" }
          : {
              type: "run_failed",
              label: "Agent run stopped safely",
              detail: "The bounded agent deadline expired",
            },
      });
      return true;
    });
    if (changed) reconciled += 1;
  }
  return { scanned: candidates.length, reconciled };
}
