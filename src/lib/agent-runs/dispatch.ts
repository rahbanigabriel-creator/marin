import { updateAgentRunDispatch } from "@/lib/agent-runs/service";
import {
  AGENT_RUN_EXECUTE_EVENT,
  inngest,
  isAgentRunDispatchConfigured,
} from "@/lib/jobs/inngest";

export async function dispatchAgentRun(input: {
  workspaceId: string;
  runId: string;
}) {
  if (!isAgentRunDispatchConfigured()) {
    return updateAgentRunDispatch({
      ...input,
      status: "unavailable",
      errorCode: "inngest_not_configured",
    });
  }
  try {
    await inngest.send({
      name: AGENT_RUN_EXECUTE_EVENT,
      data: { workspaceId: input.workspaceId, runId: input.runId },
      id: `agent-run:${input.runId}`,
    });
    return updateAgentRunDispatch({
      ...input,
      status: "sent",
      errorCode: null,
    });
  } catch {
    return updateAgentRunDispatch({
      ...input,
      status: "unavailable",
      errorCode: "dispatch_failed",
    });
  }
}
