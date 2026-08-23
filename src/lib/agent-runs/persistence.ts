import type { Prisma } from "@prisma/client";

import { createAgentPublicEvent } from "@/lib/agent-runs/events";

type AgentPublicEventInput = Parameters<typeof createAgentPublicEvent>[0];

export async function lockAgentRun(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  runId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "agent_runs"
    WHERE "id" = ${runId} AND "workspace_id" = ${workspaceId}
    FOR UPDATE
  `;
  if (!rows.length) {
    const { AgentRunNotFoundError } = await import("@/lib/agent-runs/errors");
    throw new AgentRunNotFoundError();
  }
}

export async function appendAgentRunEvent(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    runId: string;
    eventKey: string;
    event: AgentPublicEventInput;
  },
): Promise<void> {
  const existing = await tx.agentRunEvent.findUnique({
    where: {
      runId_eventKey: { runId: input.runId, eventKey: input.eventKey },
    },
    select: { id: true },
  });
  if (existing) return;
  const latest = await tx.agentRunEvent.aggregate({
    where: { runId: input.runId, workspaceId: input.workspaceId },
    _max: { sequence: true },
  });
  const event = createAgentPublicEvent(input.event);
  await tx.agentRunEvent.create({
    data: {
      workspaceId: input.workspaceId,
      runId: input.runId,
      sequence: (latest._max.sequence ?? 0) + 1,
      eventKey: input.eventKey,
      type: event.type,
      label: event.label,
      detail: event.detail,
      objectType: event.objectType,
      objectId: event.objectId,
      evidenceIds: event.evidenceIds,
    },
  });
}
