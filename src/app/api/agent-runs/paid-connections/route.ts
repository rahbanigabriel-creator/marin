import { NextResponse } from "next/server";

import {
  AGENT_RUN_NO_STORE,
  agentRunApiFailure,
  agentRunDatabaseUnavailable,
  requireAgentRunReadAccess,
} from "@/app/api/agent-runs/_lib/http";
import { listPaidMonitorConnections } from "@/lib/agent-runs/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const unavailable = agentRunDatabaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireAgentRunReadAccess();
    const connections = await listPaidMonitorConnections(access.workspace.id);
    return NextResponse.json({ connections }, { headers: AGENT_RUN_NO_STORE });
  } catch (error) {
    return agentRunApiFailure(error, "list_paid_monitor_connections");
  }
}
