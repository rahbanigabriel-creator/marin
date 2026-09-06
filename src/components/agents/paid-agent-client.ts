import type { CheckDto, WorkspaceDto } from "@/lib/paid-agents/dto";
import type { PolicyCommand } from "@/lib/paid-agents/service";

export class PaidAgentClientError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new PaidAgentClientError(data?.message ?? "The paid agent request could not be completed", response.status, data?.code ?? "unavailable");
  if (!data) throw new PaidAgentClientError("The paid agent response was unavailable", 502, "unavailable");
  return data as T;
}

export const loadPaidAgents = (signal?: AbortSignal) => request<WorkspaceDto>("/api/paid-agents", { signal });
export const loadPaidHistory = (policyId: string, cursor?: string, signal?: AbortSignal) => request<{ checks: CheckDto[]; nextCursor: string | null }>(`/api/paid-agents/${encodeURIComponent(policyId)}/checks${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { signal });
export const paidAgentCommand = (command: PolicyCommand, requestId: string) => request<{ policyId: string; checkId?: string; dispatched: boolean | null }>("/api/paid-agents", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...command, requestId }),
});
