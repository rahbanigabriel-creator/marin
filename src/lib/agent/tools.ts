import type Anthropic from "@anthropic-ai/sdk";
import { retrieveDoctrine, formatRetrieved } from "@/lib/rag/retrieve";
import type {
  BriefData,
  MarketScanData,
  ProposedStep,
  RootCauseData,
  RecommendationsData,
  RecommendationTag,
  Tone,
} from "@/types/artifacts";
import type { ActionPlanInput } from "@/lib/actions/persist";

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
  add_market_scan: "doctrine",
  add_diagnosis: "doctrine",
  add_audit: "doctrine",
  add_action_plan: "doctrine",
  ask_questions: "doctrine",
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
    name: "add_market_scan",
    description:
      "Render the HERO Market Scan card — the designed, structured way to show a competitor / market landscape (use this instead of a plain card whenever you've researched who the competitors are and where the user stands). Fill it from your live research: a one-line 'read' (your sharp take), the ranked field by share of market with the user's OWN row marked you:true, and the concrete openings where they can win. Add headline stats and a momentum line when you have them. This is what makes the answer look like a strategist's briefing, not a chat reply — prefer it over add_canvas_card for any 'analyze my market / competitors / where I stand' answer.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Card title, e.g. 'Market scan: project-management SaaS'." },
        read: {
          type: "string",
          description:
            "Your one-line take, shown as the dark callout — e.g. \"You're #5 of 7, but the two leaders are beatable on TikTok and branded search.\"",
        },
        stats: {
          type: "array",
          description: "Optional 1–3 headline stats (market size, your share, growth).",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string", description: "e.g. '$2.3B', '4.2%', '+58%'." },
              sub: { type: "string" },
            },
            required: ["label", "value"],
          },
        },
        field: {
          type: "array",
          description: "Competitors ranked by share of market (2–8 rows). Mark the user's own row with you:true.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Competitor (or the user's brand) name." },
              sharePct: { type: "number", description: "Estimated share of market, 0–100." },
              you: { type: "boolean", description: "true for the user's own row." },
            },
            required: ["name", "sharePct"],
          },
        },
        momentum: {
          type: "object",
          description: "Optional growth comparison.",
          properties: {
            label: { type: "string", description: "Optional context, e.g. 'last 12 months'." },
            you: { type: "string", description: "The user's growth, e.g. '+58%'." },
            market: { type: "string", description: "Market-average growth, e.g. '+24%'." },
          },
          required: ["you", "market"],
        },
        openings: {
          type: "array",
          description: "2–5 concrete openings — where the user can win.",
          items: { type: "string" },
        },
        cta: {
          type: "string",
          description: "Optional closing next step. Phrase as a proposal if it spends money or posts publicly.",
        },
      },
      required: ["title", "read", "field"],
    },
  },
  {
    name: "add_diagnosis",
    description:
      "Render a DIAGNOSIS card — the designed template for performance questions ('why is my CPA up?', 'my ROAS dropped', 'my funnel is leaking'). Give the metric that moved, the direction of the change, a one-line summary, and a RANKED cause cascade (most-likely first) — each cause with how to confirm it and its likely impact. Use this over a plain card for any 'why is my X happening' answer. With zero connected data, diagnose from expertise: name the metric and describe the change qualitatively ('trending up'); never invent the user's exact numbers.",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string", description: "The metric that moved, e.g. 'CPA', 'ROAS', 'conversion rate'." },
        change: {
          type: "string",
          description:
            "The change, described QUALITATIVELY ('rising', 'down sharply', 'roughly doubled'). Only use a specific figure if the USER stated it — never invent the user's numbers.",
        },
        direction: {
          type: "string",
          description: "Is the change bad, good, or neutral for the user? one of: bad | good | neutral.",
        },
        summary: { type: "string", description: "One-line framing of what's going on." },
        drivers: {
          type: "array",
          description: "Ranked causes, most-likely first (2–6). Each: the cause, how to confirm it, and its likely impact.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "The cause, e.g. 'Auction competition rose'." },
              detail: { type: "string", description: "How to confirm it / what to look at." },
              impact: {
                type: "string",
                description:
                  "Likely impact, QUALITATIVE — e.g. 'High', 'Biggest lever', 'Minor'. Don't attach invented percentages; only use a figure if the user gave it.",
              },
            },
            required: ["label", "detail"],
          },
        },
      },
      required: ["metric", "change", "summary", "drivers"],
    },
  },
  {
    name: "add_audit",
    description:
      "Render an AUDIT card — the designed template for 'audit my website / funnel / SEO / account': a prioritized list of the highest-leverage fixes, each tagged by type and with its expected impact. Use this over a plain card whenever you've reviewed a site/funnel and have concrete fixes. You actually fetched and read the page, so ground each fix in what you found.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Optional audit title, e.g. 'Website & funnel audit'." },
        items: {
          type: "array",
          description: "3–6 prioritized fixes, highest-leverage first.",
          items: {
            type: "object",
            properties: {
              tag: {
                type: "string",
                description: "One of: Quick win | Growth | Cleanup.",
              },
              title: { type: "string", description: "The fix, e.g. 'Add a clear above-the-fold CTA'." },
              body: { type: "string", description: "What's wrong and what to do about it." },
              impact: { type: "string", description: "Expected impact, e.g. 'High', '+conversion'." },
            },
            required: ["tag", "title", "body"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "add_action_plan",
    description:
      "Render an EXECUTABLE action plan in the workspace — this is how Marpin ACTS, not just talks. Use it whenever the user wants to DO something (launch, post, create, fix, grow): a short situation summary, then a PRIORITIZED list of concrete steps the user can run with one click. For each step give: a clear title; the FULL pre-written content ready to ship (the actual post copy, the ad brief, the page description, the SEO fix); the platform key (x_ads, meta_ads, linkedin_ads, tiktok_ads, pinterest_ads, reddit_ads, snapchat_ads, google_ads — or OMIT for SEO/website/email/manual work); and a kind (tweet | post | ad_draft | page | pin | seo_meta | email | manual). Set needsAsset:true when a step needs an image/video. You propose intent ONLY — never claim a step is done; the user's click is the approval and the server decides what actually executes.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Plan title, e.g. 'Launch plan for Kromse'." },
        subtitle: { type: "string", description: "Optional one-line framing." },
        situation: {
          type: "array",
          description: "Optional current-situation summary (e.g. you vs competitors): 1–3 sections.",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              points: { type: "array", items: { type: "string" } },
            },
            required: ["heading", "points"],
          },
        },
        steps: {
          type: "array",
          description: "Prioritized, one-by-one executable steps.",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string", description: "The full, ready-to-ship content for this step." },
              platform: { type: "string", description: "Connector key, or omit for SEO/website/email/manual." },
              kind: { type: "string", description: "tweet | post | ad_draft | page | pin | seo_meta | email | manual" },
              needsAsset: { type: "boolean" },
            },
            required: ["title", "description", "kind"],
          },
        },
      },
      required: ["title", "steps"],
    },
  },
  {
    name: "ask_questions",
    description:
      "Ask the user 1–3 quick multiple-choice questions IN ONE PANEL (clickable buttons, so they tap instead of typing). Use this for the PARAMETERS you need before acting — e.g. monthly budget, target market / geography, primary goal. ALWAYS make the LAST option 'Decide for me' so the user can offload the call. Do NOT use this to ask for their website or a free-text description — for that just ask in one plain sentence (no tool). Critically: you can NEVER build a real marketing strategy without budget + target market, so once the business is known and the user wants a strategy/plan, ask those here BEFORE producing it (in one panel, not one at a time). After calling it, write at most a one-line lead-in and STOP — wait for their answers.",
    input_schema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "1–3 questions, each with 2–4 short options. Always make the last option 'Decide for me'.",
          items: {
            type: "object",
            properties: {
              question: {
                type: "string",
                description: "The question in your own voice (e.g. \"What's your monthly budget?\").",
              },
              options: {
                type: "array",
                items: { type: "string" },
                description: "2–4 short options; make the last one 'Decide for me'.",
              },
            },
            required: ["question", "options"],
          },
        },
      },
      required: ["questions"],
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
 * Coerce an `add_market_scan` tool input into a validated `marketScan` artifact,
 * or null if it lacks a title, read, and at least two field rows. Defensive: the
 * model's JSON is untrusted, so every field is checked, trimmed, and clamped.
 */
export function marketScanFromInput(input: unknown): { kind: "marketScan"; data: MarketScanData } | null {
  const o = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const title = str(o.title);
  const read = str(o.read);
  const field = (Array.isArray(o.field) ? o.field : [])
    .map((f) => {
      const obj = (f ?? {}) as Record<string, unknown>;
      const name = typeof obj.name === "string" ? obj.name.trim() : "";
      const sharePct = typeof obj.sharePct === "number" && isFinite(obj.sharePct) ? obj.sharePct : NaN;
      return { name, sharePct, you: obj.you === true ? true : undefined };
    })
    .filter((f) => f.name.length > 0 && !Number.isNaN(f.sharePct))
    .map((f) => ({ ...f, sharePct: Math.max(0, Math.min(100, Math.round(f.sharePct * 10) / 10)) }));
  if (!title || !read || field.length < 2) return null;

  const stats = (Array.isArray(o.stats) ? o.stats : [])
    .map((s) => {
      const obj = (s ?? {}) as Record<string, unknown>;
      return { label: str(obj.label) ?? "", value: str(obj.value) ?? "", sub: str(obj.sub) };
    })
    .filter((s) => s.label && s.value);
  const openings = (Array.isArray(o.openings) ? o.openings : [])
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim());
  const mo = (o.momentum ?? null) as Record<string, unknown> | null;
  const momentum =
    mo && str(mo.you) && str(mo.market)
      ? { label: str(mo.label) ?? "", you: str(mo.you)!, market: str(mo.market)! }
      : undefined;

  const data: MarketScanData = {
    title,
    read,
    stats: stats.length ? stats : undefined,
    field,
    momentum,
    openings: openings.length ? openings : undefined,
    cta: str(o.cta),
  };
  return { kind: "marketScan", data };
}

/**
 * Coerce an `add_diagnosis` tool input into a validated `rootCause` artifact (the
 * ranked cause cascade for a performance question), or null if unusable.
 */
export function diagnosisFromInput(input: unknown): { kind: "rootCause"; data: RootCauseData } | null {
  const o = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const metric = str(o.metric);
  const change = str(o.change);
  const summary = str(o.summary);
  const drivers = (Array.isArray(o.drivers) ? o.drivers : [])
    .map((d) => {
      const obj = (d ?? {}) as Record<string, unknown>;
      return {
        label: str(obj.label) ?? "",
        detail: str(obj.detail) ?? "",
        impact: str(obj.impact) ?? "",
      };
    })
    .filter((d) => d.label.length > 0);
  if (!metric || !change || !summary || drivers.length === 0) return null;
  const dir = str(o.direction)?.toLowerCase();
  const tone: Tone = dir === "good" ? "good" : dir === "neutral" ? "neutral" : "bad";
  return { kind: "rootCause", data: { metric, change, tone, summary, drivers } };
}

const REC_TAGS: RecommendationTag[] = ["Quick win", "Growth", "Cleanup"];

/**
 * Coerce an `add_audit` tool input into a validated `recommendations` artifact (a
 * prioritized list of tagged fixes), or null if it has no usable items.
 */
export function auditFromInput(input: unknown): { kind: "recommendations"; data: RecommendationsData } | null {
  const o = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const items = (Array.isArray(o.items) ? o.items : [])
    .map((it, i) => {
      const obj = (it ?? {}) as Record<string, unknown>;
      const rawTag = str(obj.tag);
      const tag: RecommendationTag =
        (REC_TAGS.find((t) => t.toLowerCase() === rawTag?.toLowerCase()) as RecommendationTag) ?? "Quick win";
      return {
        id: `rec-${i}`,
        tag,
        title: str(obj.title) ?? "",
        body: str(obj.body) ?? "",
        impact: str(obj.impact) ?? "",
      };
    })
    .filter((it) => it.title.length > 0 && it.body.length > 0);
  if (items.length === 0) return null;
  return { kind: "recommendations", data: { items } };
}

/**
 * Coerce an `add_action_plan` tool input into a validated ActionPlanInput (intent
 * only — title, optional situation, ProposedStep[]). The loop hands this to
 * persistActionPlan, which is the trust boundary that computes execMode/approval.
 */
export function actionPlanInputFromTool(input: unknown): ActionPlanInput | null {
  const o = (input ?? {}) as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const steps: ProposedStep[] = (Array.isArray(o.steps) ? o.steps : [])
    .map((s) => {
      const obj = (s ?? {}) as Record<string, unknown>;
      return {
        title: typeof obj.title === "string" ? obj.title.trim() : "",
        description: typeof obj.description === "string" ? obj.description.trim() : "",
        platform: typeof obj.platform === "string" && obj.platform.trim() ? obj.platform.trim() : undefined,
        kind: typeof obj.kind === "string" && obj.kind.trim() ? obj.kind.trim() : "manual",
        needsAsset: typeof obj.needsAsset === "boolean" ? obj.needsAsset : undefined,
      };
    })
    .filter((s) => s.title.length > 0 && s.description.length > 0);
  const situation = (Array.isArray(o.situation) ? o.situation : [])
    .map((sec) => {
      const obj = (sec ?? {}) as Record<string, unknown>;
      const heading = typeof obj.heading === "string" ? obj.heading.trim() : "";
      const points = Array.isArray(obj.points)
        ? obj.points.filter((p): p is string => typeof p === "string" && p.trim().length > 0).map((p) => p.trim())
        : [];
      return { heading, points };
    })
    .filter((sec) => sec.heading.length > 0 || sec.points.length > 0);
  if (!title || steps.length === 0) return null;
  return {
    title,
    subtitle: typeof o.subtitle === "string" && o.subtitle.trim() ? o.subtitle.trim() : undefined,
    situation: situation.length ? situation : undefined,
    steps,
  };
}

/**
 * Coerce an `ask_question` tool input into a validated question + clickable
 * options (the Claude-style multiple-choice prompt), or null if unusable.
 */
export function questionsFromInput(
  input: unknown,
): { questions: { question: string; options: string[] }[] } | null {
  const o = (input ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(o.questions) ? o.questions : [];
  const questions = raw
    .map((q) => {
      const obj = (q ?? {}) as Record<string, unknown>;
      const question = typeof obj.question === "string" ? obj.question.trim() : "";
      const options = Array.isArray(obj.options)
        ? obj.options
            .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
            .map((x) => x.trim())
            .slice(0, 5)
        : [];
      return { question, options };
    })
    .filter((q) => q.question.length > 0 && q.options.length > 0)
    .slice(0, 3);
  if (questions.length === 0) return null;
  return { questions };
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

  if (name === "add_market_scan") {
    // The loop intercepts this to render the card; defensive fallback only.
    const ok = marketScanFromInput(input) !== null;
    return {
      content: ok
        ? "Market scan rendered on the canvas."
        : "Market scan needs a title, a read, and at least two field rows.",
      isError: !ok,
    };
  }

  if (name === "add_diagnosis") {
    const ok = diagnosisFromInput(input) !== null;
    return {
      content: ok
        ? "Diagnosis rendered on the canvas."
        : "Diagnosis needs a metric, a change, a summary, and at least one cause.",
      isError: !ok,
    };
  }

  if (name === "add_audit") {
    const ok = auditFromInput(input) !== null;
    return {
      content: ok ? "Audit rendered on the canvas." : "Audit needs at least one fix with a title and body.",
      isError: !ok,
    };
  }

  if (name === "add_action_plan") {
    // The loop intercepts this (it persists + renders the plan); defensive fallback.
    const ok = actionPlanInputFromTool(input) !== null;
    return {
      content: ok
        ? "Action plan rendered with executable steps."
        : "Action plan needs a title and at least one step.",
      isError: !ok,
    };
  }

  if (name === "ask_questions") {
    // The loop intercepts this to render clickable options; defensive fallback.
    const ok = questionsFromInput(input) !== null;
    return {
      content: ok
        ? "Questions shown to the user with clickable options."
        : "ask_questions needs at least one question with options.",
      isError: !ok,
    };
  }

  return { content: `Tool not implemented: ${name}`, isError: true };
}
