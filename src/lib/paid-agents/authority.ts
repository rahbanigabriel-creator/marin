import { PaidAgentError } from "./policy";
import { readBoundedResponseText, withAbortSignal } from "@/lib/connectors/oauth";

export interface ActorAuthority {
  actorId: string;
  workspaceSlug: string;
}

export type VerifyActor = (input: ActorAuthority) => Promise<void>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Two exact, non-paginated Clerk reads at most; never trust a stored role alone. */
export async function verifyCurrentActor(input: ActorAuthority, dependencies: {
  fetch?: typeof fetch;
  secretKey?: string;
  signal?: AbortSignal;
} = {}): Promise<void> {
  const secretKey = dependencies.secretKey ?? process.env.CLERK_SECRET_KEY;
  if (!secretKey || !/^user_[A-Za-z0-9]+$/.test(input.actorId)) {
    throw new PaidAgentError("authority_unavailable", "Current account authority cannot be verified. Scheduled checks are stopped.");
  }
  const orgId = input.workspaceSlug.startsWith("org-") ? input.workspaceSlug.slice(4) : null;
  if (orgId ? !/^org_[A-Za-z0-9]+$/.test(orgId) : input.workspaceSlug !== `user-${input.actorId}`) {
    throw new PaidAgentError("authority_revoked", "This actor is not the authoritative owner or administrator of the workspace.");
  }
  const signal = AbortSignal.any([AbortSignal.timeout(8_000), ...(dependencies.signal ? [dependencies.signal] : [])]);
  const read = async (path: string) => {
    let response: Response;
    try {
      response = await withAbortSignal((dependencies.fetch ?? fetch)(`https://api.clerk.com/v1/${path}`, {
        method: "GET", headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
        cache: "no-store", redirect: "error", signal,
      }), signal);
    } catch { throw new PaidAgentError("authority_unavailable", "Current Clerk authority is unavailable. No provider recommendation was made."); }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status === 404) throw new PaidAgentError("authority_revoked", "The actor or organization membership no longer exists.");
      throw new PaidAgentError("authority_unavailable", "Current Clerk authority is unavailable. No provider recommendation was made.");
    }
    try {
      const parsed = record(JSON.parse(await readBoundedResponseText(response, { signal, maxBytes: 64 * 1024 })));
      if (!parsed) throw new Error("invalid_response");
      return parsed;
    } catch { throw new PaidAgentError("authority_unavailable", "Clerk authority evidence could not be verified."); }
  };
  const user = await read(`users/${encodeURIComponent(input.actorId)}`);
  if (user.id !== input.actorId || user.banned !== false || user.locked !== false) {
    throw new PaidAgentError("authority_revoked", "This actor is deleted, banned, locked, or no longer authorized.");
  }
  if (!orgId) return;
  const query = new URLSearchParams({ user_id: input.actorId, limit: "1" });
  const membershipList = await read(`organizations/${encodeURIComponent(orgId)}/memberships?${query}`);
  const memberships = Array.isArray(membershipList.data) ? membershipList.data : [];
  const membership = memberships.length === 1 ? record(memberships[0]) : null;
  if (membershipList.total_count !== 1 || membership?.role !== "org:admin" || record(membership?.public_user_data)?.user_id !== input.actorId || record(membership?.organization)?.id !== orgId) {
    throw new PaidAgentError("authority_revoked", "Current Clerk organization administrator access is required. Stored workspace roles cannot grant access.");
  }
}
