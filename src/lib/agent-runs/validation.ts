import {
  AGENT_APPROVAL_KINDS,
  AGENT_RUN_MODES,
  type AgentApprovalDecisionRequest,
  type AgentRunCommandRequest,
  type AgentRunListQuery,
  type AgentRunLimits,
  type AgentRunRequest,
  type AgentRunStatus,
} from "@/lib/agent-runs/types";

export const DEFAULT_AGENT_RUN_LIMITS: Readonly<AgentRunLimits> = Object.freeze({
  maxSteps: 24,
  maxToolCalls: 40,
  maxModelTurns: 12,
  maxWebReads: 6,
  maxCredits: 20,
});

export class AgentRunValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AgentRunValidationError";
  }
}

const RUN_STATUSES = new Set<AgentRunStatus>([
  "queued",
  "running",
  "waiting_input",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled",
]);

const SECRET_MARKER = /(chain[ -]?of[ -]?thought|hidden reasoning|system prompt|bearer\s+|access[_-]?token|refresh[_-]?token|client[_-]?secret|password\s*[:=]|sk_live_|gocspx-)/i;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentRunValidationError("invalid_body", "A JSON object is required");
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new AgentRunValidationError("invalid_field", `${field} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new AgentRunValidationError("invalid_field", `${field} is invalid`);
  }
  if (SECRET_MARKER.test(normalized)) {
    throw new AgentRunValidationError("unsafe_content", `${field} contains unsupported sensitive content`);
  }
  return normalized;
}

function exactKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  if (Object.keys(body).some((key) => !keys.has(key))) {
    throw new AgentRunValidationError("unknown_field", "The request contains an unsupported field");
  }
}

function requestId(value: unknown): string {
  const result = requiredText(value, "requestId", 100);
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(result)) {
    throw new AgentRunValidationError("invalid_request_id", "requestId is invalid");
  }
  return result;
}

export function parseAgentRunRequest(value: unknown): AgentRunRequest {
  const body = object(value);
  exactKeys(body, ["brandId", "conversationId", "goal", "mode", "requestId", "target"]);
  const parsedRequestId = requestId(body.requestId);
  if (typeof body.mode !== "string" || !AGENT_RUN_MODES.includes(body.mode as AgentRunRequest["mode"])) {
    throw new AgentRunValidationError("invalid_mode", "mode is invalid");
  }
  let conversationId: string | null = null;
  if (body.conversationId !== undefined && body.conversationId !== null) {
    conversationId = requiredText(body.conversationId, "conversationId", 191);
  }
  let target: AgentRunRequest["target"] = null;
  if (body.target !== undefined && body.target !== null) {
    const targetBody = object(body.target);
    exactKeys(targetBody, ["kind", "objectId"]);
    if (targetBody.kind !== "paid_create_paused" && targetBody.kind !== "paid_activate") {
      throw new AgentRunValidationError("invalid_target_kind", "target kind is invalid");
    }
    target = {
      kind: targetBody.kind,
      objectId: requiredText(targetBody.objectId, "target.objectId", 191),
    };
  }
  if (target && body.mode !== "paid") {
    throw new AgentRunValidationError("invalid_target", "Only paid runs accept a paid draft target");
  }
  return {
    brandId: requiredText(body.brandId, "brandId", 191),
    conversationId,
    goal: requiredText(body.goal, "goal", 4_000),
    mode: body.mode as AgentRunRequest["mode"],
    requestId: parsedRequestId,
    target,
  };
}

export function parseAgentRunCommand(value: unknown): AgentRunCommandRequest {
  const body = object(value);
  exactKeys(body, ["requestId"]);
  return { requestId: requestId(body.requestId) };
}

export function parseAgentApprovalDecision(value: unknown): AgentApprovalDecisionRequest {
  const body = object(value);
  exactKeys(body, [
    "requestId",
    "decision",
    "stepId",
    "kind",
    "objectType",
    "objectId",
    "objectVersion",
    "snapshotHash",
    "accountId",
  ]);
  if (body.decision !== "accepted" && body.decision !== "rejected") {
    throw new AgentRunValidationError("invalid_decision", "decision is invalid");
  }
  if (typeof body.kind !== "string" || !AGENT_APPROVAL_KINDS.includes(body.kind as never)) {
    throw new AgentRunValidationError("invalid_approval_kind", "kind is invalid");
  }
  if (!Number.isSafeInteger(body.objectVersion) || (body.objectVersion as number) < 1) {
    throw new AgentRunValidationError("invalid_object_version", "objectVersion is invalid");
  }
  const snapshotHash = requiredText(body.snapshotHash, "snapshotHash", 64);
  if (!/^[a-f0-9]{64}$/.test(snapshotHash)) {
    throw new AgentRunValidationError("invalid_snapshot_hash", "snapshotHash is invalid");
  }
  let accountId: string | null = null;
  if (body.accountId !== undefined && body.accountId !== null) {
    accountId = requiredText(body.accountId, "accountId", 191);
  }
  return {
    requestId: requestId(body.requestId),
    decision: body.decision,
    stepId: requiredText(body.stepId, "stepId", 191),
    kind: body.kind as AgentApprovalDecisionRequest["kind"],
    objectType: requiredText(body.objectType, "objectType", 80),
    objectId: requiredText(body.objectId, "objectId", 191),
    objectVersion: body.objectVersion as number,
    snapshotHash,
    accountId,
  };
}

export function parseAgentRunId(value: unknown): string {
  return requiredText(value, "runId", 191);
}

export function parseAgentRunListQuery(request: Request): AgentRunListQuery {
  const url = new URL(request.url);
  const allowed = new Set(["status", "brandId", "limit"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new AgentRunValidationError("invalid_query", "The query is invalid");
    }
  }
  const statusValue = url.searchParams.get("status");
  if (statusValue && !RUN_STATUSES.has(statusValue as AgentRunStatus)) {
    throw new AgentRunValidationError("invalid_status", "status is invalid");
  }
  const limitValue = url.searchParams.get("limit");
  const limit = limitValue === null ? 50 : Number(limitValue);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new AgentRunValidationError("invalid_limit", "limit is invalid");
  }
  const brandIdValue = url.searchParams.get("brandId");
  return {
    status: statusValue as AgentRunStatus | null,
    brandId: brandIdValue ? requiredText(brandIdValue, "brandId", 191) : null,
    limit,
  };
}

const TRANSITIONS: Record<AgentRunStatus, readonly AgentRunStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["waiting_input", "waiting_approval", "succeeded", "failed", "cancelled"],
  waiting_input: ["running", "cancelled"],
  waiting_approval: ["running", "cancelled"],
  succeeded: [],
  failed: ["running"],
  cancelled: [],
};

export function canTransitionAgentRun(
  from: AgentRunStatus,
  to: AgentRunStatus,
  options: { explicitRetry?: boolean } = {},
): boolean {
  if (!TRANSITIONS[from].includes(to)) return false;
  if (from === "failed" && to === "running") return options.explicitRetry === true;
  return true;
}

export function boundedRunLimits(value: Partial<AgentRunLimits> = {}): AgentRunLimits {
  const result = { ...DEFAULT_AGENT_RUN_LIMITS, ...value };
  for (const [key, limit] of Object.entries(result)) {
    const maximum = DEFAULT_AGENT_RUN_LIMITS[key as keyof AgentRunLimits];
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
      throw new AgentRunValidationError("invalid_limit", `${key} exceeds the allowed limit`);
    }
  }
  return result;
}
