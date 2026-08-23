import type {
  AgentRunDto,
  AgentRunStepDto,
} from "@/lib/agent-runs/dto";
import type { AgentApprovalDecision } from "@/lib/agent-runs/types";

interface ApiFailureBody {
  code?: unknown;
  actionUrl?: unknown;
}

interface AgentRunMutationResponse {
  run: AgentRunDto;
  replayed?: boolean;
}

export class AgentRunClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly actionUrl: string | null,
    message: string,
  ) {
    super(message);
    this.name = "AgentRunClientError";
  }
}

export function newAgentRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export function buildOrganicRunPayload(input: {
  brandId: string;
  goal: string;
  requestId: string;
}) {
  return {
    brandId: input.brandId,
    conversationId: null,
    goal: input.goal.trim(),
    mode: "organic" as const,
    requestId: input.requestId,
    target: null,
  };
}

export function buildAgentCommandPayload(requestId: string) {
  return { requestId };
}

export function buildApprovalDecisionPayload(input: {
  step: AgentRunStepDto;
  decision: AgentApprovalDecision;
  requestId: string;
}) {
  const binding = input.step.approvalBinding;
  if (!binding) throw new Error("This step has no exact approval binding.");
  return {
    requestId: input.requestId,
    decision: input.decision,
    stepId: input.step.id,
    kind: binding.kind,
    objectType: binding.objectType,
    objectId: binding.objectId,
    objectVersion: binding.objectVersion,
    snapshotHash: binding.snapshotHash,
    accountId: binding.accountId,
  };
}

function safeApiMessage(status: number, code: string): string {
  if (status === 401) return "Your session expired. Sign in again, then retry.";
  if (status === 402) return "Your current plan cannot start another agent action.";
  if (status === 403 && code === "agent_runs_upgrade_required") {
    return "Your current plan does not include automated agent actions.";
  }
  if (status === 403) return "Only workspace owners and admins can perform this agent action.";
  if (status === 404) return "This agent run is no longer available.";
  if (status === 409) return "This run changed before the action completed. The latest version has been loaded.";
  if (status === 422) return "The agent request could not be validated. Review the goal and try again.";
  if (status === 429) return "Too many agent actions were requested. Wait a moment, then retry.";
  if (status === 503) return "Agent runs are temporarily unavailable. No action was taken.";
  return "The agent request could not be completed. No unconfirmed action is shown as successful.";
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as T | ApiFailureBody | null;
  if (!response.ok) {
    const failure = payload as ApiFailureBody | null;
    const code = typeof failure?.code === "string" ? failure.code : "agent_request_failed";
    throw new AgentRunClientError(
      response.status,
      code,
      typeof failure?.actionUrl === "string" ? failure.actionUrl : null,
      safeApiMessage(response.status, code),
    );
  }
  if (!payload) {
    throw new AgentRunClientError(
      500,
      "invalid_response",
      null,
      safeApiMessage(500, "invalid_response"),
    );
  }
  return payload as T;
}

function mutationInit(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function listAgentRuns(signal?: AbortSignal): Promise<AgentRunDto[]> {
  const response = await fetch("/api/agent-runs?limit=50", {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  const payload = await parseResponse<{ runs: AgentRunDto[] }>(response);
  return Array.isArray(payload.runs) ? payload.runs : [];
}

export async function getAgentRun(runId: string, signal?: AbortSignal): Promise<AgentRunDto> {
  const response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  return (await parseResponse<{ run: AgentRunDto }>(response)).run;
}

export async function startOrganicAgentRun(input: {
  brandId: string;
  goal: string;
}): Promise<AgentRunDto> {
  const response = await fetch(
    "/api/agent-runs",
    mutationInit(
      buildOrganicRunPayload({
        ...input,
        requestId: newAgentRequestId(),
      }),
    ),
  );
  return (await parseResponse<AgentRunMutationResponse>(response)).run;
}

export async function cancelAgentRun(runId: string): Promise<AgentRunDto> {
  const response = await fetch(
    `/api/agent-runs/${encodeURIComponent(runId)}/cancel`,
    mutationInit(buildAgentCommandPayload(newAgentRequestId())),
  );
  return (await parseResponse<AgentRunMutationResponse>(response)).run;
}

export async function retryAgentRun(runId: string): Promise<AgentRunDto> {
  const response = await fetch(
    `/api/agent-runs/${encodeURIComponent(runId)}/retry`,
    mutationInit(buildAgentCommandPayload(newAgentRequestId())),
  );
  return (await parseResponse<AgentRunMutationResponse>(response)).run;
}

export async function decideAgentRunApproval(input: {
  runId: string;
  step: AgentRunStepDto;
  decision: AgentApprovalDecision;
}): Promise<AgentRunDto> {
  const response = await fetch(
    `/api/agent-runs/${encodeURIComponent(input.runId)}/approvals`,
    mutationInit(
      buildApprovalDecisionPayload({
        step: input.step,
        decision: input.decision,
        requestId: newAgentRequestId(),
      }),
    ),
  );
  return (await parseResponse<AgentRunMutationResponse>(response)).run;
}
