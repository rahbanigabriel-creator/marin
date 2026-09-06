import { NextResponse } from "next/server";
import { AGENT_RUN_NO_STORE, agentRunApiFailure } from "@/app/api/agent-runs/_lib/http";
import { PaidAgentError, exactKeys, identifier, object, parsePolicy, version } from "@/lib/paid-agents/policy";
import type { PolicyCommand } from "@/lib/paid-agents/service";

export function paidAgentFailure(error: unknown): NextResponse {
  if (error instanceof PaidAgentError) return NextResponse.json({ code: error.code, message: error.message }, { status: error.status, headers: AGENT_RUN_NO_STORE });
  return agentRunApiFailure(error, "paid_goal");
}

export function parseCommand(value: unknown): { requestId: string; command: PolicyCommand } {
  const row = object(value);
  const requestId = identifier(row.requestId);
  if (row.kind === "create") {
    exactKeys(row, ["kind", "requestId", "policy"]);
    return { requestId, command: { kind: "create", policy: parsePolicy(row.policy) } };
  }
  const policyId = identifier(row.policyId);
  const revision = version(row.version);
  if (row.kind === "edit") {
    exactKeys(row, ["kind", "requestId", "policyId", "version", "policy"]);
    return { requestId, command: { kind: "edit", policyId, version: revision, policy: parsePolicy(row.policy) } };
  }
  if (row.kind === "check" || row.kind === "pause" || row.kind === "resume") {
    exactKeys(row, ["kind", "requestId", "policyId", "version"]);
    return { requestId, command: { kind: row.kind, policyId, version: revision } };
  }
  if (row.kind === "review" && (row.decision === "acknowledged" || row.decision === "dismissed")) {
    exactKeys(row, ["kind", "requestId", "policyId", "version", "checkId", "decision"]);
    return { requestId, command: { kind: "review", policyId, version: revision, checkId: identifier(row.checkId), decision: row.decision } };
  }
  throw new PaidAgentError("unsupported_action", "Only saved goals, read-only checks, and recommendation acknowledgement are supported", 422);
}
