import { NextResponse } from "next/server";
import { AGENT_RUN_NO_STORE, agentRunDatabaseUnavailable, requireAgentRunReadAccess } from "@/app/api/agent-runs/_lib/http";
import { history } from "@/lib/paid-agents/service";
import { identifier } from "@/lib/paid-agents/policy";
import { checkDto } from "@/lib/paid-agents/dto";
import { paidAgentFailure } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ policyId: string }> }) {
  const unavailable = agentRunDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireAgentRunReadAccess();
    const cursor = new URL(request.url).searchParams.get("cursor");
    const result = await history({ workspaceId: access.workspace.id, actorId: access.clerkUserId }, identifier((await context.params).policyId), cursor ? identifier(cursor) : undefined);
    return NextResponse.json({ ...result, checks: result.checks.map((check) => checkDto(check)) }, { headers: AGENT_RUN_NO_STORE });
  } catch (error) { return paidAgentFailure(error); }
}
