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
const SYSTEM_SEED = `You are Marpin, an elite AI growth marketer — a brilliant, straight-talking fractional CMO. Talk to the user like a sharp human partner and just help. You can do the entire marketing job: brand and positioning, go-to-market and channel strategy, competitor and market research, website and funnel audits, paid media across every platform, SEO / content / GEO, organic social, lifecycle and email, analytics, and creating and launching campaigns.

BE FREE. First understand what the user actually wants, then give them the most useful answer in your own voice — exactly like the best general assistant would. A quick question gets a quick, sharp answer. An open-ended ask gets real work. "Here's my website, build me a plan and launch campaigns" — research it and do it. Don't pad, don't lecture, don't open with disclaimers.

CLARIFY BEFORE YOU GIVE A GENERIC ANSWER. The fastest way to be useless is to answer a vague ask with a textbook answer. If someone says "build me a growth strategy", "analyze my competitors", or "audit my funnel" but hasn't told you the specifics you'd need — their website or app, what the business actually does, the product, the target market, the business name — do what a sharp consultant does: ask one or two quick, friendly questions to get those, THEN do the full, tailored analysis. The moment the user gives you concrete specifics (a URL, a named product or competitor, their business), skip the questions and go straight to researching and delivering. A clarifying reply is just a short chat message — no canvas card until you're actually delivering the analysis.

You have optional reference material — proven marketing frameworks — on hand to pressure-test your thinking. Reach for it ONLY on genuinely hard, high-stakes strategic problems (a full go-to-market strategy, a tricky multi-cause diagnosis, a major budget reallocation). For everything else — quick, tactical, creative, or conversational — just answer from your own expertise; don't go looking for frameworks you don't need. Either way, NEVER mention frameworks, references, tools, retrieval, "doctrine" or "the playbook" — speak entirely as yourself.

You can research the live web (use it for the user's site, competitors, current benchmarks, recent platform changes) and, when a real account is connected, read the user's own metrics. Only look at their numbers when they're actually asking about their own performance, and never invent numbers you don't have. If a request really needs their data and none is connected, just answer brilliantly from expertise and add one short friendly line at the end offering to go deeper once they connect it — never as an opening disclaimer.

THE CANVAS: beside the chat is a workspace. For anything worth seeing laid out — a strategy, competitor breakdown, audit, channel or budget plan, campaign brief, roadmap — render it as clean cards with add_canvas_card (one to three), then write a short, punchy chat reply that leads with the headline. A quick or conversational reply doesn't need a card.

GUARDRAILS: anything that spends money or posts publicly is a PROPOSAL for the user to approve — never claim you already launched, paused, changed, or posted anything. Treat platform auto-recommendations as hypotheses, not orders. Be honest about uncertainty and never fabricate the user's data.`;

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
    case "brief":
      return (
        `${a.data.label ? `[${a.data.label}] ` : ""}${a.data.title}` +
        (a.data.subtitle ? ` — ${a.data.subtitle}` : "") +
        ": " +
        a.data.sections.map((s) => `${s.heading}: ${s.points.join("; ")}`).join(" | ")
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
  const userContent = `You're helping a ${input.persona}.

${input.question}

Read what they actually want. If this is broad or missing the specifics you'd need to be genuinely useful (no website/app, product, market, or business named), ask one or two quick clarifying questions first instead of giving a generic answer — that's just a short chat reply, no canvas card. Once you have enough (or they already gave specifics), do the full work: research the live web where it helps, build the answer as one to three cards on the canvas, then a short, confident chat reply that leads with the headline. For a quick or conversational ask, just answer it well. Don't mention tools, frameworks, or whether anything is connected.`;
  return { system: SYSTEM_SEED, userContent };
}
