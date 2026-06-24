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
  marketing_playbook: "doctrine",
  get_account_metrics: "internal",
  add_canvas_card: "doctrine",
  ask_question: "doctrine",
};

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "marketing_playbook",
    description:
      "Optionally consult Marpin's digital marketing playbook — a curated set of growth frameworks — when a genuinely HARD strategic problem might benefit from it (a full go-to-market strategy, a tricky multi-cause diagnosis, a major budget reallocation). Using it is ENTIRELY your call: most of the time your own expertise is plenty, so skip it for quick, tactical, creative, conversational, or single-metric asks, and never let it be a reason to clarify or stall. If you do consult it and what comes back isn't actually relevant or better than what you already know, IGNORE it and answer from your own judgment — never force playbook content into an answer where it doesn't fit. Always answer in your OWN voice; never mention the playbook, this tool, or any ids/codes to the user. Needs no connected account.",
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
    name: "ask_question",
    description:
      "When you genuinely need ONE quick piece of context before you can give a great answer, ask it with THIS instead of writing the question as prose — it renders your question with clickable answer buttons so the user can just tap. Give 2–4 short, concrete, distinct options that cover the likely answers (the user can also type their own). Use it only for a truly underspecified ask, never to stall and never when you can already act. After calling it, write at most a one-line lead-in and STOP — wait for their pick; do not answer for them.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The single question to ask, in your own voice (e.g. 'What stage is the business at?').",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description: "2–4 short, distinct answer options the user can click.",
        },
      },
      required: ["question", "options"],
    },
  },
  {
    name: "get_account_metrics",
    description:
      "Returns the user's CONNECTED marketing-account data (KPIs, spend, ROAS, CPA, campaigns, leaks, funnel) from Marpin's internal store. ONLY call this when the user has a real account connected AND the question is about their own data; ground every number you state in the result and never invent metrics. For generic strategy/competitor/SEO/measurement questions, do NOT call this — answer from your own expertise and live web research. If it returns 'no connected-account data', do not fabricate numbers — answer from your expertise and note what connecting an account would unlock.",
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

/**
 * Coerce an `ask_question` tool input into a validated question + clickable
 * options (the Claude-style multiple-choice prompt), or null if unusable.
 */
export function choicesFromInput(input: unknown): { question: string; options: string[] } | null {
  const o = (input ?? {}) as Record<string, unknown>;
  const question = typeof o.question === "string" ? o.question.trim() : "";
  const options = Array.isArray(o.options)
    ? o.options
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim())
        .slice(0, 5)
    : [];
  if (!question || options.length === 0) return null;
  return { question, options };
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

  if (name === "marketing_playbook") {
    const { query, intent } = (input as { query?: string; intent?: string } | null) ?? {};
    const q = (query ?? "").trim();
    if (!q) {
      return { content: "marketing_playbook requires a non-empty 'query'.", isError: true };
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

  if (name === "ask_question") {
    // The loop intercepts this to render clickable options; defensive fallback.
    const ok = choicesFromInput(input) !== null;
    return {
      content: ok
        ? "Question shown to the user with clickable options."
        : "ask_question needs a question and at least one option.",
      isError: !ok,
    };
  }

  return { content: `Tool not implemented: ${name}`, isError: true };
}
