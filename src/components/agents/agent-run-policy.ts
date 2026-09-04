import type {
  AgentRunDto,
  AgentRunStepDto,
} from "@/lib/agent-runs/dto";

export interface AgentRunActionPolicy {
  canCancel: boolean;
  canRetry: boolean;
  canDecideApproval: boolean;
}

const NONTERMINAL_STATUSES = new Set([
  "queued",
  "running",
  "waiting_input",
  "waiting_approval",
]);

export function pendingApprovalStep(run: AgentRunDto): AgentRunStepDto | null {
  if (run.status !== "waiting_approval") return null;
  const decidedStepIds = new Set(run.approvals.map((approval) => approval.stepId));
  return (
    run.steps.find(
      (step) =>
        step.status === "waiting_approval" &&
        step.approvalBinding !== null &&
        !decidedStepIds.has(step.id),
    ) ?? null
  );
}

export function agentRunActionPolicy(
  run: AgentRunDto,
  canManage: boolean,
): AgentRunActionPolicy {
  if (!canManage) {
    return { canCancel: false, canRetry: false, canDecideApproval: false };
  }
  return {
    canCancel:
      NONTERMINAL_STATUSES.has(run.status) &&
      run.cancelRequestedAt === null,
    // This mirrors the current server contract. Cancelled-run retry requires a
    // backend transition before it can be exposed safely.
    canRetry:
      run.status === "failed" ||
      (run.status === "queued" && run.dispatchStatus === "unavailable"),
    canDecideApproval: pendingApprovalStep(run) !== null,
  };
}

export function shouldPollAgentRun(run: AgentRunDto): boolean {
  if (run.cancelRequestedAt !== null && run.status === "running") return true;
  if (run.status === "running") return true;
  return run.status === "queued" && run.dispatchStatus !== "unavailable";
}

export function agentRunStatusLabel(run: AgentRunDto): string {
  if (run.cancelRequestedAt !== null && run.status === "running") return "Stopping";
  if (run.status === "queued" && run.dispatchStatus === "unavailable") {
    return "Worker unavailable";
  }
  const labels: Record<AgentRunDto["status"], string> = {
    queued: "Queued",
    running: "Running",
    waiting_input: "Needs input",
    waiting_approval: "Needs approval",
    succeeded: "Completed",
    failed: "Stopped",
    cancelled: "Cancelled",
  };
  return labels[run.status];
}

export function agentRunStatusTone(
  run: AgentRunDto,
): "neutral" | "progress" | "warning" | "success" | "danger" {
  if (run.status === "queued" && run.dispatchStatus === "unavailable") return "danger";
  if (run.cancelRequestedAt !== null && run.status === "running") return "warning";
  if (run.status === "queued" || run.status === "running") return "progress";
  if (run.status === "waiting_input" || run.status === "waiting_approval") return "warning";
  if (run.status === "succeeded") return "success";
  if (run.status === "failed") return "danger";
  return "neutral";
}

export function dispatchMessage(run: AgentRunDto): string {
  if (run.dispatchStatus === "unavailable") {
    return "The worker is unavailable. This run did not start; retry after the worker is restored.";
  }
  if (run.dispatchStatus === "pending") {
    return "Preparing a bounded worker request.";
  }
  if (run.status === "queued") return "The bounded worker accepted this run and will start shortly.";
  return "The bounded worker accepted this run.";
}

const FAILURE_MESSAGES: Record<string, string> = {
  approval_binding_invalid: "The approval request expired or no longer matched the reviewed operation.",
  approval_binding_missing: "The exact approval request was no longer available.",
  approval_object_unsupported: "This operation is not available to the agent yet.",
  approval_stale: "The reviewed object changed, so the run stopped before taking action.",
  capability_denied: "Your current role or plan no longer permits this action.",
  deadline_exceeded: "The run reached its time limit and stopped safely.",
  internal_tool_failed: "A reviewed internal step could not be completed.",
  limit_reached: "The run reached its configured usage limit and stopped safely.",
  monitor_binding_invalid: "The selected paid account or recent monitoring window is no longer valid.",
  monitor_connection_unavailable: "The selected Google Ads or Meta Ads account is no longer connected.",
  monitor_data_limit: "The paid dataset is too large for this bounded monitor run.",
  plan_unavailable: "This reviewed agent workflow is temporarily unavailable.",
};

export function safeFailureMessage(code: string | null | undefined): string {
  if (!code) return "The run stopped safely before it completed.";
  return FAILURE_MESSAGES[code] ?? "The run stopped safely before it completed.";
}

export function formatAgentLabel(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function shortHashSuffix(hash: string): string {
  return `...${hash.slice(-8)}`;
}
