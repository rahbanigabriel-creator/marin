import {
  AGENT_PUBLIC_EVENT_TYPES,
  type AgentPublicEvent,
  type AgentPublicEventType,
} from "@/lib/agent-runs/types";

const FORBIDDEN = /(chain.of.thought|hidden reasoning|system prompt|bearer\s+|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|sk_live_|gocspx-)/i;

function publicText(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maximum || FORBIDDEN.test(normalized)) {
    throw new TypeError("Unsafe public agent event text");
  }
  return normalized;
}

export function createAgentPublicEvent(input: {
  type: AgentPublicEventType;
  label: string;
  detail?: string | null;
  objectType?: string | null;
  objectId?: string | null;
  evidenceIds?: string[];
}): AgentPublicEvent {
  if (!AGENT_PUBLIC_EVENT_TYPES.includes(input.type)) throw new TypeError("Unsupported event type");
  const evidenceIds = input.evidenceIds ?? [];
  if (evidenceIds.length > 20) throw new TypeError("Too many evidence references");
  return {
    type: input.type,
    label: publicText(input.label, 160),
    detail: input.detail ? publicText(input.detail, 500) : null,
    objectType: input.objectType ? publicText(input.objectType, 80) : null,
    objectId: input.objectId ? publicText(input.objectId, 191) : null,
    evidenceIds: evidenceIds.map((id) => publicText(id, 191)),
  };
}
