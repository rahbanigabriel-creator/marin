import type Anthropic from "@anthropic-ai/sdk";
import { retrieveDoctrine, formatRetrieved } from "@/lib/rag/retrieve";

/**
 * The agent's tool catalog + dispatcher (architecture §4).
 *
 * PHASE 1 — ZERO-CONNECTOR BRAIN. The agent is a world-class marketer with NO
 * accounts connected: it grounds answers in the doctrine corpus (retrieve_doctrine)
 * and reasons from first principles, NEVER in fake/placeholder account numbers.
 *
 * Two tool scopes:
 *   • doctrine — retrieve_doctrine. The zero-connector grounding source. ALWAYS
 *     available, never gated; this is what the agent reaches for first.
 *   • internal — get_account_metrics. Reads the user's CONNECTED-account data.
 *     Only useful when a real connection exists; for generic strategy / competitor
 *     / SEO questions the agent must NOT call it (there is nothing real to read,
 *     and we never present sample data as the user's numbers).
 *
 * The old "internal-first, refuse every external tool until an account read"
 * rule is GONE: it forced an account read for generic questions and was the root
 * of the "fake numbers as real data" bug. Doctrine retrieval has no precondition.
 *
 * NOTE: this catalog holds only Marpin's CUSTOM tools. The Anthropic web_search
 * SERVER tool (live web research) is composed in at the loop's call site (see
 * loop.ts AGENT_TOOLS) — Anthropic executes it and returns results inline, so it
 * is never dispatched here and has no entry in TOOL_SCOPE.
 */
export type ToolScope = "doctrine" | "internal" | "external";

export const TOOL_SCOPE: Record<string, ToolScope> = {
  retrieve_doctrine: "doctrine",
  get_account_metrics: "internal",
};

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "retrieve_doctrine",
    description:
      "Retrieve the relevant marketing-doctrine frameworks for a question from Marpin's curated corpus (diagnostic waterfalls, attribution, unit economics, SEO/GEO, competitor research, creative, growth strategy). Call this FIRST for any strategy, diagnostic, competitor, SEO/GEO, measurement, or tactical question — it returns the exact signals, API fields, numeric thresholds, and disambiguation logic to ground your answer in. Returns parent-document markdown; ground your reasoning in it and cite the framework ids you used. Does NOT require any connected account.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The user's question (or a focused sub-question) to retrieve doctrine for, e.g. 'why is my ROAS down', 'how do I research competitors', 'growth strategy for a SaaS on a small budget'.",
        },
        intent: {
          type: "string",
          description:
            "Optional classified intent to bias retrieval: one of strategy | diagnostic | competitor | seo-geo | measurement | tactical | action.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_account_metrics",
    description:
      "Returns the user's CONNECTED marketing-account data (KPIs, spend, ROAS, CPA, campaigns, leaks, funnel) from Marpin's internal store. ONLY call this when the user has a real account connected AND the question is about their own data; ground every number you state in the result and never invent metrics. For generic strategy/competitor/SEO/measurement questions, do NOT call this — use retrieve_doctrine instead. If it returns 'no connected-account data', do not fabricate numbers — answer from doctrine and say what connecting an account would unlock.",
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

/** Backing data source for internal reads. Sample data only behind a demo flag. */
export interface MetricsSource {
  getAccountMetrics(sections?: string[]): string;
}

/** Per-turn dispatch state. Retained for tracing/telemetry; no longer gates tools. */
export interface DispatchCtx {
  internalReadDone: boolean;
  doctrineRetrieved: boolean;
  /** Set once the model triggers a web_search server-tool round (pause_turn). */
  searchedWeb: boolean;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

/**
 * Execute one tool call. Doctrine retrieval is always allowed (zero-connector
 * grounding). Account reads are allowed but optional — the model decides whether
 * the question is about the user's real data. Never throws for unknown-tool
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

  if (name === "retrieve_doctrine") {
    const { query, intent } = (input as { query?: string; intent?: string } | null) ?? {};
    const q = (query ?? "").trim();
    if (!q) {
      return { content: "retrieve_doctrine requires a non-empty 'query'.", isError: true };
    }
    const docs = retrieveDoctrine(q, { intent });
    ctx.doctrineRetrieved = true;
    return { content: formatRetrieved(docs), isError: false };
  }

  if (name === "get_account_metrics") {
    const sections = (input as { sections?: string[] } | null)?.sections;
    ctx.internalReadDone = true;
    return { content: source.getAccountMetrics(sections), isError: false };
  }

  return { content: `Tool not implemented: ${name}`, isError: true };
}
