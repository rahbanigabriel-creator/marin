import type Anthropic from "@anthropic-ai/sdk";
import { retrieveDoctrine, formatRetrieved } from "@/lib/rag/retrieve";
import type { BriefData } from "@/types/artifacts";

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
  marketing_reference: "doctrine",
  get_account_metrics: "internal",
  add_canvas_card: "doctrine",
};

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "marketing_reference",
    description:
      "Privately consult proven marketing frameworks to pressure-test your thinking on a genuinely HARD strategic problem — a full go-to-market strategy, a tricky multi-cause diagnosis, a major budget reallocation. SKIP it for quick, tactical, creative, or conversational asks, and skip it while you're still clarifying scope; just answer from your own expertise. When you do use it, reason from it silently and answer in your OWN voice — never mention this tool, frameworks, references, 'doctrine', or any ids/codes to the user. Does NOT require any connected account.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The hard strategic question (or a focused sub-question) to pull frameworks for, e.g. 'go-to-market for a B2B SaaS on a small budget', 'why did blended CAC jump across channels'.",
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
    name: "add_canvas_card",
    description:
      "Render a clean, structured card in the workspace canvas beside the chat — this is how you SHOW your work visually (strategy, competitor analysis, website/funnel audit, channel or budget plan, campaign brief, SEO/content roadmap). Works with zero connected data. Call it 1–3 times to build the visual answer, each call adding one card, THEN write a short chat summary. Keep each card focused: 2–6 sections, each a heading with 2–6 tight bullet points. Use real, specific, expert content — not placeholders.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "Card title, e.g. 'Go-to-market strategy', 'Competitor analysis: Notion vs Coda', '90-day SEO roadmap', 'Launch campaign: spring promo'.",
        },
        subtitle: { type: "string", description: "Optional one-line subtitle for context." },
        label: {
          type: "string",
          description:
            "Optional short tag shown on the card, e.g. 'Strategy', 'Competitors', 'Audit', 'Campaign', 'SEO', 'Plan'.",
        },
        sections: {
          type: "array",
          description: "2–6 sections, each a heading plus 2–6 concise bullet points.",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              points: { type: "array", items: { type: "string" } },
            },
            required: ["heading", "points"],
          },
        },
        cta: {
          type: "string",
          description:
            "Optional closing next-step line. If it proposes spending money or posting publicly, phrase it as a proposal awaiting approval.",
        },
      },
      required: ["title", "sections"],
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

/**
 * Coerce an `add_canvas_card` tool input into a validated `brief` artifact, or
 * null if it has no usable title + sections. Defensive: the model's JSON is
 * untrusted, so every field is checked and trimmed. The loop renders the result
 * directly to the canvas (it never goes through the normal text dispatch path).
 */
export function briefFromInput(input: unknown): { kind: "brief"; data: BriefData } | null {
  const o = (input ?? {}) as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const rawSections = Array.isArray(o.sections) ? o.sections : [];
  const sections = rawSections
    .map((s) => {
      const sec = (s ?? {}) as Record<string, unknown>;
      const heading = typeof sec.heading === "string" ? sec.heading.trim() : "";
      const points = Array.isArray(sec.points)
        ? sec.points
            .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
            .map((p) => p.trim())
        : [];
      return { heading, points };
    })
    .filter((s) => s.heading.length > 0 || s.points.length > 0);
  if (!title || sections.length === 0) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const data: BriefData = {
    title,
    subtitle: str(o.subtitle),
    label: str(o.label),
    sections,
    cta: str(o.cta),
  };
  return { kind: "brief", data };
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

  if (name === "marketing_reference") {
    const { query, intent } = (input as { query?: string; intent?: string } | null) ?? {};
    const q = (query ?? "").trim();
    if (!q) {
      return { content: "marketing_reference requires a non-empty 'query'.", isError: true };
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

  if (name === "add_canvas_card") {
    // The agent loop intercepts this to render the card on the canvas; reaching
    // dispatch is a defensive fallback that simply acknowledges the call.
    const ok = briefFromInput(input) !== null;
    return {
      content: ok ? "Card rendered on the canvas." : "Card needs a title and at least one section.",
      isError: !ok,
    };
  }

  return { content: `Tool not implemented: ${name}`, isError: true };
}
