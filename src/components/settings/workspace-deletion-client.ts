import type { DeletionRequestView } from "@/lib/privacy/deletion/types";

export interface WorkspaceDeletionPreparation {
  deletion: DeletionRequestView | null;
  confirmationPhrase: string | null;
  role: "owner" | "admin" | "member" | null;
  canDelete: boolean;
}

interface DeletionMutationResponse {
  deletion: DeletionRequestView;
  replayed: boolean;
}

interface ErrorPayload {
  error?: string;
  code?: string;
  message?: string;
}

export class WorkspaceDeletionClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "WorkspaceDeletionClientError";
  }
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload;
  if (!response.ok) {
    throw new WorkspaceDeletionClientError(
      payload.message ?? "The deletion request could not be completed.",
      response.status,
      payload.code ?? payload.error ?? null,
    );
  }
  return payload;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  return jsonResponse<T>(await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  }));
}

export function newDeletionRequestId(prefix: "create" | "retry"): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

export function loadWorkspaceDeletionPreparation(
  signal?: AbortSignal,
): Promise<WorkspaceDeletionPreparation> {
  return request<WorkspaceDeletionPreparation>("/api/settings/deletion", { signal });
}

export async function loadWorkspaceDeletion(
  deletionRequestId: string,
  signal?: AbortSignal,
): Promise<DeletionRequestView> {
  const result = await request<{ deletion: DeletionRequestView }>(
    `/api/settings/deletion/${encodeURIComponent(deletionRequestId)}`,
    { signal },
  );
  return result.deletion;
}

export function createWorkspaceDeletion(input: {
  confirmation: string;
  requestId: string;
}): Promise<DeletionMutationResponse> {
  return request<DeletionMutationResponse>("/api/settings/deletion", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function retryWorkspaceDeletion(input: {
  deletionRequestId: string;
  requestId: string;
}): Promise<DeletionMutationResponse> {
  return request<DeletionMutationResponse>(
    `/api/settings/deletion/${encodeURIComponent(input.deletionRequestId)}/retry`,
    { method: "POST", body: JSON.stringify({ requestId: input.requestId }) },
  );
}
