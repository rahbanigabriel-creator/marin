import { NextResponse } from "next/server";
import { AGENT_RUN_NO_STORE, agentRunDatabaseUnavailable, agentRunOriginFailure, enforceAgentRunMutationLimit, readAgentRunJson, requireAgentRunManageAccess, requireAgentRunReadAccess } from "@/app/api/agent-runs/_lib/http";
import { command, listWorkspace } from "@/lib/paid-agents/service";
import { policyDto } from "@/lib/paid-agents/dto";
import { dispatchPaidCheck } from "@/lib/paid-agents/runner";
import { paidAgentFailure, parseCommand } from "./_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const unavailable = agentRunDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireAgentRunReadAccess();
    const data = await listWorkspace({ workspaceId: access.workspace.id, actorId: access.clerkUserId });
    return NextResponse.json({ ...data, policies: data.policies.map(policyDto) }, { headers: AGENT_RUN_NO_STORE });
  } catch (error) { return paidAgentFailure(error); }
}

export async function POST(request: Request) {
  const originFailure = agentRunOriginFailure(request);
  if (originFailure) return originFailure;
  const unavailable = agentRunDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireAgentRunManageAccess();
    const limited = await enforceAgentRunMutationLimit(request);
    if (limited) return limited;
    const input = parseCommand(await readAgentRunJson(request));
    const identity = { workspaceId: access.workspace.id, actorId: access.clerkUserId };
    const result = await command(identity, input.requestId, input.command);
    const dispatched = result.checkId && input.command.kind === "check"
      ? await dispatchPaidCheck({ workspaceId: identity.workspaceId, checkId: result.checkId }) : null;
    return NextResponse.json({ ...result, dispatched }, { headers: AGENT_RUN_NO_STORE });
  } catch (error) { return paidAgentFailure(error); }
}
