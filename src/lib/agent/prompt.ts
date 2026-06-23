import type { Persona } from "@/types/scenario";
import type { ArtifactPayload } from "@/lib/streaming/events";

/**
 * Context engineering for the "marketing master" (architecture §3). The system
 * seed is STABLE across every turn so it caches as a prefix; the volatile
 * context (the question) goes in the user message.
 *
 * PHASE 1 — ZERO-CONNECTOR BRAIN. This is the Part B master system prompt from
 * docs/rag/corpus-seed.md adopted unchanged in spirit: with NO accounts connected
 * Marpin is still a world-class strategist that answers from DOCTRINE + research,
 * NEVER from fake/placeholder account numbers. The three non-negotiable principles
 * (diagnose-before-you-act, retrieve-doctrine-first, be-skeptical-of-platform-recs)
 * and the intent-routing rule ("do NOT force an account read for generic
 * questions; never invent or use placeholder numbers") are wired in here.
 */
const SYSTEM_SEED = `You are Marpin — the world's best growth marketer, an autonomous agent. With zero connected accounts you are still a world-class strategist: you answer strategy, competitor, SEO/GEO, creative, measurement and unit-economics questions from doctrine + research, grounded in real knowledge. With accounts connected, you ground every claim in the user's real data. You are fluent across paid search (Google Ads), paid social (Meta, TikTok, LinkedIn), SEO and Search Console, and GA4 analytics.

THREE NON-NEGOTIABLE PRINCIPLES
1. DIAGNOSE BEFORE YOU ACT. For any "why did metric X change", follow the controllable→uncontrollable waterfall (DOC-DIAG-000): (0) validate the signal is real, (1) campaign mechanics, (2) creative/audience, (3) demand, (4) exogenous, (5) only then ranked solutions. Never jump to bid/budget/creative changes before completing it.
2. RETRIEVE DOCTRINE FIRST. Before account data, external research, or actions, call retrieve_doctrine to pull the relevant framework — it tells you WHICH signals, WHICH API fields, the numeric THRESHOLDS, and HOW to disambiguate. Retrieve → reason → recommend. Ground your answer in the doctrine you retrieved.
3. BE SKEPTICAL OF PLATFORM RECOMMENDATIONS (DOC-PRAC-SPEND): platforms maximize the advertiser's SPEND, not profit. Treat optimization score, auto-apply, broad-match pushes and budget-raise nudges as hypotheses to test against the profit goal — never instructions.

INTENT ROUTING: classify each query (strategy / diagnostic / competitor / SEO-GEO / measurement / tactical / action) and decide where to go FIRST. For generic strategy/competitor/SEO/measurement questions, retrieve doctrine and answer from knowledge — do NOT call get_account_metrics; there is nothing real to read and you must NEVER invent or use placeholder numbers or graphs. Read account data ONLY when a real connection exists AND the question is about the user's own metrics. If get_account_metrics returns "no connected-account data", do not fabricate figures: answer from doctrine and note what connecting an account would unlock.

LIVE WEB RESEARCH: you have a web_search tool. Use it to ground time-sensitive or external claims in current reality — competitor moves, platform/policy changes, benchmark ranges, pricing, market trends, anything that may have shifted since training. Prefer it over recalling possibly-stale facts. It returns real public sources; cite what you found. It does NOT see the user's private account data (that is get_account_metrics only). Do not use web results to invent the user's own metrics.

OUTPUT: lead with the decision — open with the single most important insight (and, only if real data supports it, its € impact), then the recommended action. For a diagnosis, give a ranked diagnosis (cause → confidence High >70 / Med 40–70 / Low <40 → evidence → controllable?) then solutions ranked by likelihood × leverage. Be concise and concrete: 2–3 sentences of plain prose a non-expert founder understands — no preamble, no hedging, no bullet lists, no markdown, asterisks, bold or headings. State uncertainty; flag modeled/delayed data (iOS, Consent Mode) and any surface unavailable via API (e.g. competitor Auction Insights).

GUARDRAILS: anything that SPENDS money or POSTS publicly is a PROPOSAL — present the exact change for human approval; never claim you have already changed a budget, paused a campaign, or launched anything. Anchor to blended/independent revenue; treat platform numbers as directional. Most degraded situations have 2–3 simultaneous causes — don't stop at the first.`;

function euro(n: number): string {
  return "€" + Math.round(n).toLocaleString("en-US");
}

/** Compact, model-readable summary of one artifact's data. */
function serializeArtifact(a: ArtifactPayload): string {
  switch (a.kind) {
    case "kpis":
      return "KPIs — " + a.data.map((k) => `${k.label} ${k.value} (${k.delta})`).join(", ");
    case "chart":
      return `14-day trend: ${a.data.title} — ${a.data.sub}`;
    case "leaks":
      return (
        `Wasted spend ${a.data.total}. Leaks: ` +
        a.data.items.map((i) => `${i.name} [${i.channel}] ${euro(i.wasted)} @ ${i.roas} ROAS`).join("; ")
      );
    case "funnel":
      return (
        "Funnel: " +
        a.data.stages
          .map((s) => `${s.label} ${s.value}${s.rate && s.rate !== "—" ? ` (${s.rate})` : ""}`)
          .join(" → ")
      );
    case "recommendations":
      return "Recommendations: " + a.data.items.map((r) => `${r.title} (${r.impact})`).join("; ");
    case "campaign":
      return `Drafted campaign "${a.data.title}" — ${a.data.spec.objective}, budget ${a.data.spec.budget}, est ${a.data.spec.estRoas} ROAS`;
    case "platformComparison":
      return (
        `Platform comparison (${a.data.title}): ` +
        a.data.rows.map((r) => `${r.platform} ROAS ${r.roas} CPA ${r.cpa} [${r.verdict}]`).join("; ")
      );
    case "healthVerdict":
      return (
        `Health verdict: ${a.data.status} — ${a.data.headline}. ` +
        a.data.metrics.map((m) => `${m.label} ${m.value}`).join(", ")
      );
    case "rootCause":
      return (
        `Root cause — ${a.data.metric} ${a.data.change}: ${a.data.summary} Drivers: ` +
        a.data.drivers.map((d) => `${d.label} (${d.impact})`).join("; ")
      );
    case "trackingHealth":
      return (
        `Tracking — ${a.data.summary} Checks: ` +
        a.data.checks.map((c) => `${c.label} [${c.status}]`).join(", ")
      );
    case "forecastResult":
      return `Forecast: at ${euro(a.data.budget)}/mo → ${a.data.conversions.toLocaleString("en-US")} conv, ${euro(a.data.revenue)} rev (${a.data.roas}× ROAS), range ${euro(a.data.revenueLow)}–${euro(a.data.revenueHigh)}. ${a.data.basis}`;
    case "planAllocation":
      return (
        `Starter plan for ${a.data.business} (${a.data.goal}), ${euro(a.data.budget)}/mo: ` +
        a.data.allocations.map((al) => `${al.channel} ${euro(al.amount)} (${al.pct}%)`).join(", ") +
        `. Projected ${a.data.projected.conversions.toLocaleString("en-US")} conv, ${euro(a.data.projected.revenue)} rev (${a.data.projected.roas}).`
      );
    default: {
      const _never: never = a;
      return _never;
    }
  }
}

/**
 * Model-readable serialization of the account artifacts. This is what the
 * get_account_metrics tool returns on an internal read (the data is no longer
 * stuffed into the prompt — the agent fetches it).
 */
export function serializeArtifacts(artifacts: ArtifactPayload[]): string {
  return artifacts.map(serializeArtifact).join("\n") || "(no internal data available)";
}

export function buildAgentPrompt(input: {
  question: string;
  persona: Persona;
}): { system: string; userContent: string } {
  const userContent = `Persona: ${input.persona}
Question: ${input.question}

Retrieve the relevant doctrine first (retrieve_doctrine). Only read get_account_metrics if this question is about the user's own connected-account data AND a connection exists; otherwise answer from doctrine + knowledge and never use placeholder numbers. Then write only the lead paragraph (2–3 sentences) for this answer, grounded in the doctrine you retrieved.`;
  return { system: SYSTEM_SEED, userContent };
}
