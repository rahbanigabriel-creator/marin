import type {
  AgentRunMode,
  AgentRunTargetRequest,
  AgentToolPolicy,
} from "@/lib/agent-runs/types";

export type AgentPlanKey =
  | "organic.weekly_plan.v1"
  | "paid.monitor.v1"
  | "paid.approval_gate.v1"
  | `input.required.${Exclude<AgentRunMode, "organic">}.v1`;

export interface RegisteredAgentPlan {
  key: AgentPlanKey;
  mode: AgentRunMode;
  tool: AgentToolPolicy;
  behavior:
    | "create_weekly_content_plan"
    | "monitor_paid_campaigns"
    | "request_input"
    | "request_paid_approval";
}

const MANAGERS = ["owner", "admin"] as const;

const PAID_APPROVAL_PLAN: RegisteredAgentPlan = Object.freeze({
  key: "paid.approval_gate.v1",
  mode: "paid",
  behavior: "request_paid_approval",
  tool: Object.freeze({
    name: "paid.operation.approval_gate",
    risk: "spend",
    roles: MANAGERS,
    entitlement: "canExecuteActions",
    maxCalls: 1,
  }),
});

const PAID_MONITOR_PLAN: RegisteredAgentPlan = Object.freeze({
  key: "paid.monitor.v1",
  mode: "paid",
  behavior: "monitor_paid_campaigns",
  tool: Object.freeze({
    name: "paid.metrics.monitor",
    risk: "read",
    roles: MANAGERS,
    entitlement: "canExecuteActions",
    maxCalls: 1,
  }),
});

const REGISTRY: Readonly<Record<AgentRunMode, RegisteredAgentPlan>> = Object.freeze({
  organic: Object.freeze({
    key: "organic.weekly_plan.v1",
    mode: "organic",
    behavior: "create_weekly_content_plan",
    tool: Object.freeze({
      name: "content.plan.create_weekly",
      risk: "internal_write",
      roles: MANAGERS,
      entitlement: "canExecuteActions",
      maxCalls: 1,
    }),
  }),
  assistant: inputPlan("assistant"),
  seo: inputPlan("seo"),
  paid: inputPlan("paid"),
  influencers: inputPlan("influencers"),
});

function inputPlan(mode: AgentRunMode): RegisteredAgentPlan {
  if (mode === "organic") throw new TypeError("Organic mode has a reviewed write plan");
  return Object.freeze({
    key: `input.required.${mode}.v1`,
    mode,
    behavior: "request_input",
    tool: Object.freeze({
      name: "workflow.request_input",
      risk: "read",
      roles: MANAGERS,
      entitlement: "canExecuteActions",
      maxCalls: 1,
    }),
  });
}

export function agentPlanForMode(mode: AgentRunMode): RegisteredAgentPlan {
  return REGISTRY[mode];
}

export function agentPlanForRequest(
  mode: AgentRunMode,
  target: AgentRunTargetRequest | null,
): RegisteredAgentPlan {
  if (mode !== "paid" || !target) return agentPlanForMode(mode);
  if (target.kind === "paid_monitor") return PAID_MONITOR_PLAN;
  return PAID_APPROVAL_PLAN;
}

export function agentPlanByKey(key: string): RegisteredAgentPlan | null {
  if (key === PAID_MONITOR_PLAN.key) return PAID_MONITOR_PLAN;
  if (key === PAID_APPROVAL_PLAN.key) return PAID_APPROVAL_PLAN;
  return Object.values(REGISTRY).find((plan) => plan.key === key) ?? null;
}
