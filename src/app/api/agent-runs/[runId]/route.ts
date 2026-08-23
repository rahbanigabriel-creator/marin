import { NextResponse } from "next/server";

import {
  AGENT_RUN_NO_STORE,
  agentRunApiFailure,
  agentRunDatabaseUnavailable,
  requireAgentRunReadAccess,
} from "@/app/api/agent-runs/_lib/http";
import { getAgentRun } from "@/lib/agent-runs/service";
import { parseAgentRunId } from "@/lib/agent-runs/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ runId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const unavailable = agentRunDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireAgentRunReadAccess();
    const { runId } = await context.params;
    const run = await getAgentRun({
      workspaceId: access.workspace.id,
      runId: parseAgentRunId(runId),
    });
    return NextResponse.json({ run }, { headers: AGENT_RUN_NO_STORE });
  } catch (error) {
    return agentRunApiFailure(error, "detail");
  }
}
