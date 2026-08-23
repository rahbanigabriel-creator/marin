import { NextResponse } from "next/server";

import {
  NotAuthenticatedError,
  WorkspaceAuthorizationError,
  requireWorkspaceRole,
} from "@/lib/auth";
import { workspaceSeatLimitResponse } from "@/lib/auth-http";
import {
  AgentRunConflictError,
  AgentRunEntitlementError,
  AgentRunNotFoundError,
  AgentRunUnavailableError,
} from "@/lib/agent-runs/errors";
import { AgentRunValidationError } from "@/lib/agent-runs/validation";
import { isDatabaseConfigured } from "@/lib/db";
import { isPersistenceModelUnavailable } from "@/lib/persistence/errors";
import { readBoundedJson, requestBodyErrorResponse } from "@/lib/security/request-body";
import {
  getSameOriginForbiddenDecision,
  validateSameOriginMutation,
} from "@/lib/security/request-origin";

export const AGENT_RUN_NO_STORE = { "Cache-Control": "private, no-store" };
const BODY_LIMIT_BYTES = 64 * 1024;

export function agentRunDatabaseUnavailable(): NextResponse | null {
  return isDatabaseConfigured()
    ? null
    : NextResponse.json(
        {
          error: "database_unavailable",
          code: "database_unavailable",
          message: "Agent runs are temporarily unavailable",
        },
        { status: 503, headers: AGENT_RUN_NO_STORE },
      );
}

export function agentRunOriginFailure(request: Request): NextResponse | null {
  const isVercel = process.env.VERCEL === "1";
  const preview =
    process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : null;
  const local = !isVercel ? new URL(request.url).origin : null;
  const decision = validateSameOriginMutation({
    headers: request.headers,
    appUrl: process.env.APP_URL ?? preview ?? local,
    nextPublicAppUrl: process.env.NEXT_PUBLIC_APP_URL ?? preview ?? local,
    isProduction: isVercel,
    allowMissingProvenanceInDevelopment: !isVercel,
  });
  if (decision.allowed) return null;
  const forbidden = getSameOriginForbiddenDecision();
  return NextResponse.json(forbidden.body, {
    status: forbidden.status,
    headers: AGENT_RUN_NO_STORE,
  });
}

export function requireAgentRunReadAccess() {
  return requireWorkspaceRole(["owner", "admin", "member"]);
}

export function requireAgentRunManageAccess() {
  return requireWorkspaceRole(["owner", "admin"]);
}

/** Auth must be resolved before this distributed limiter is invoked. */
export async function enforceAgentRunMutationLimit(request: Request) {
  const { enforceEndpointRateLimit } = await import("@/lib/security/rate-limit");
  return enforceEndpointRateLimit(request, "plan_generation");
}

export function readAgentRunJson(request: Request): Promise<unknown> {
  return readBoundedJson(request, BODY_LIMIT_BYTES);
}

export function agentRunApiFailure(error: unknown, operation: string): NextResponse {
  const bodyFailure = requestBodyErrorResponse(error);
  if (bodyFailure) return bodyFailure as NextResponse;
  const admission = workspaceSeatLimitResponse(error);
  if (admission) return admission;
  if (error instanceof NotAuthenticatedError) {
    return NextResponse.json(
      { error: "not_authenticated", code: "not_authenticated", message: error.message },
      { status: 401, headers: AGENT_RUN_NO_STORE },
    );
  }
  if (error instanceof WorkspaceAuthorizationError) {
    return NextResponse.json(
      {
        error: "forbidden",
        code: "forbidden",
        message: "Owner or admin access is required for this agent operation",
      },
      { status: 403, headers: AGENT_RUN_NO_STORE },
    );
  }
  if (error instanceof AgentRunEntitlementError) {
    return NextResponse.json(
      {
        error: error.code,
        code: error.code,
        message: error.message,
        actionUrl: "/settings/billing",
      },
      { status: 403, headers: AGENT_RUN_NO_STORE },
    );
  }
  if (error instanceof AgentRunNotFoundError) {
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: 404, headers: AGENT_RUN_NO_STORE },
    );
  }
  if (error instanceof AgentRunConflictError) {
    return NextResponse.json(
      {
        error: error.code,
        code: error.code,
        message: error.message,
        ...(error.currentVersion === undefined ? {} : { currentVersion: error.currentVersion }),
      },
      { status: 409, headers: AGENT_RUN_NO_STORE },
    );
  }
  if (error instanceof AgentRunValidationError) {
    return NextResponse.json(
      { error: error.code, code: error.code, message: error.message },
      { status: 422, headers: AGENT_RUN_NO_STORE },
    );
  }
  if (error instanceof AgentRunUnavailableError || isPersistenceModelUnavailable(error)) {
    return NextResponse.json(
      {
        error: "agent_runs_unavailable",
        code: "agent_runs_unavailable",
        message: "Agent runs are temporarily unavailable",
      },
      { status: 503, headers: AGENT_RUN_NO_STORE },
    );
  }
  console.error(`[agent-runs] ${operation} failed`);
  return NextResponse.json(
    {
      error: `${operation}_failed`,
      code: `${operation}_failed`,
      message: "The agent request could not be completed",
    },
    { status: 500, headers: AGENT_RUN_NO_STORE },
  );
}
