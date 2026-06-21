import type Anthropic from "@anthropic-ai/sdk";

/**
 * The agent's tool catalog + dispatcher (architecture §4: code-enforced
 * internal-first retrieval). Every tool is tagged internal | external. The
 * dispatcher REFUSES any external tool until an internal data read has happened
 * this turn — the LLM cannot talk its way around it, because enforcement lives
 * here in code, not in the prompt.
 *
 * M1a ships one internal tool (get_account_metrics). External tools (web_search
 * for demand data, etc.) arrive in M1d and will be gated by this same dispatcher.
 */
export type ToolScope = "internal" | "external";

export const TOOL_SCOPE: Record<string, ToolScope> = {
  get_account_metrics: "internal",
};

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_account_metrics",
    description:
      "Returns the user's connected marketing-account data (KPIs, spend, ROAS, CPA, campaigns, leaks, funnel, etc.) from Marin's internal store. Always call this before answering, and ground every number you state in the result. Do not invent metrics.",
    input_schema: {
      type: "object",
      properties: {
        sections: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional subset of data to return (e.g. ['kpis','leaks','funnel']). Omit to return everything available.",
        },
      },
    },
  },
];

/** Backing data source for internal reads. M1a: canned; M1c swaps in the DB. */
export interface MetricsSource {
  getAccountMetrics(sections?: string[]): string;
}

/** Per-turn dispatch state — tracks whether internal-first has been satisfied. */
export interface DispatchCtx {
  internalReadDone: boolean;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

/**
 * Execute one tool call under the internal-first rule. Returns a tool_result
 * payload (string) and an error flag; never throws for policy / unknown-tool
 * cases (those come back as is_error results the model can react to).
 */
export async function dispatchTool(
  name: string,
  input: unknown,
  source: MetricsSource,
  ctx: DispatchCtx,
): Promise<ToolOutcome> {
  const scope = TOOL_SCOPE[name];

  if (!scope) {
    return { content: `Unknown tool: ${name}`, isError: true };
  }

  // The core guarantee: no external call before an internal read.
  if (scope === "external" && !ctx.internalReadDone) {
    return {
      content:
        "Blocked by policy: you must read internal account data (get_account_metrics) before using any external tool.",
      isError: true,
    };
  }

  if (name === "get_account_metrics") {
    const sections = (input as { sections?: string[] } | null)?.sections;
    ctx.internalReadDone = true;
    return { content: source.getAccountMetrics(sections), isError: false };
  }

  return { content: `Tool not implemented: ${name}`, isError: true };
}
