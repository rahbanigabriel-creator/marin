import { NextResponse } from "next/server";

import {
  AGENT_RUN_NO_STORE,
  agentRunApiFailure,
  agentRunDatabaseUnavailable,
  agentRunOriginFailure,
  enforceAgentRunMutationLimit,
  readAgentRunJson,
  requireAgentRunManageAccess,
  requireAgentRunReadAccess,
} from "@/app/api/agent-runs/_lib/http";
import { createAgentRun, listAgentRuns } from "@/lib/agent-runs/service";
import { parseAgentRunListQuery, parseAgentRunRequest } from "@/lib/agent-runs/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const unavailable = agentRunDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireAgentRunReadAccess();
    const runs = await listAgentRuns({
      workspaceId: access.workspace.id,
      query: parseAgentRunListQuery(request),
    });
    return NextResponse.json({ runs }, { headers: AGENT_RUN_NO_STORE });
  } catch (error) {
    return agentRunApiFailure(error, "list");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const originFailure = agentRunOriginFailure(request);
  if (originFailure) return originFailure;
  const unavailable = agentRunDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireAgentRunManageAccess();
    const limited = await enforceAgentRunMutationLimit(request);
    if (limited) return limited;
    const result = await createAgentRun({
      workspaceId: access.workspace.id,
      actorId: access.clerkUserId,
      actorRole: access.role,
      request: parseAgentRunRequest(await readAgentRunJson(request)),
    });
    const run = result.replayed
      ? result.run
      : await (await import("@/lib/agent-runs/dispatch")).dispatchAgentRun({
          workspaceId: access.workspace.id,
          runId: result.run.id,
        });
    return NextResponse.json(
      { run, replayed: result.replayed },
      { status: result.replayed ? 200 : 201, headers: AGENT_RUN_NO_STORE },
    );
  } catch (error) {
    return agentRunApiFailure(error, "create");
  }
}
