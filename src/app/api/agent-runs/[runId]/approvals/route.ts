import { NextResponse } from "next/server";

import {
  AGENT_RUN_NO_STORE,
  agentRunApiFailure,
  agentRunDatabaseUnavailable,
  agentRunOriginFailure,
  enforceAgentRunMutationLimit,
  readAgentRunJson,
  requireAgentRunManageAccess,
} from "@/app/api/agent-runs/_lib/http";
import { decideAgentRunApproval } from "@/lib/agent-runs/service";
import { parseAgentApprovalDecision, parseAgentRunId } from "@/lib/agent-runs/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ runId: string }> }

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const originFailure = agentRunOriginFailure(request);
  if (originFailure) return originFailure;
  const unavailable = agentRunDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireAgentRunManageAccess();
    const limited = await enforceAgentRunMutationLimit(request);
    if (limited) return limited;
    const { runId } = await context.params;
    const decision = parseAgentApprovalDecision(await readAgentRunJson(request));
    const result = await decideAgentRunApproval({
      workspaceId: access.workspace.id,
      runId: parseAgentRunId(runId),
      actorId: access.clerkUserId,
      actorRole: access.role,
      decision,
    });
    const run = !result.replayed && decision.decision === "accepted"
      ? await (await import("@/lib/agent-runs/dispatch")).dispatchAgentRun({
          workspaceId: access.workspace.id,
          runId: result.run.id,
        })
      : result.run;
    return NextResponse.json({ run, replayed: result.replayed }, { headers: AGENT_RUN_NO_STORE });
  } catch (error) {
    return agentRunApiFailure(error, "approval");
  }
}
