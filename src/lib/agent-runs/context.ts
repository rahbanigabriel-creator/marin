import type {
  AgentContextSnapshot,
  AgentRunMode,
} from "@/lib/agent-runs/types";

const MAX_FACTS = 80;
const MAX_TURNS = 10;
const MAX_VALUE = 2_000;
const SECRET_MARKER = /(bearer\s+|oauth|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|sk_live_|gocspx-)/i;

function safeText(value: string, maximum = MAX_VALUE): string {
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, maximum);
  if (SECRET_MARKER.test(normalized)) return "[redacted]";
  return normalized;
}

export function buildAgentContext(input: {
  brandId: string;
  contextVersion: number;
  mode: AgentRunMode;
  timezone: string;
  facts: AgentContextSnapshot["facts"];
  recentTurns: AgentContextSnapshot["recentTurns"];
}): AgentContextSnapshot {
  if (!input.brandId || !Number.isSafeInteger(input.contextVersion) || input.contextVersion < 1) {
    throw new TypeError("Valid brand context is required");
  }
  return {
    brandId: input.brandId,
    contextVersion: input.contextVersion,
    mode: input.mode,
    timezone: safeText(input.timezone, 120) || "UTC",
    facts: input.facts.slice(0, MAX_FACTS).map((fact) => ({
      key: safeText(fact.key, 160),
      value: safeText(fact.value),
      source: safeText(fact.source, 160),
      observedAt: fact.observedAt,
      verificationStatus: fact.verificationStatus,
    })),
    recentTurns: input.recentTurns.slice(-MAX_TURNS).map((turn) => ({
      role: turn.role,
      content: safeText(turn.content, 4_000),
    })),
  };
}
