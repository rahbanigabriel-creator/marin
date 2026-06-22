import type { Persona } from "@/types/scenario";
import type { ArtifactPayload } from "@/lib/streaming/events";

/**
 * Context engineering for the "marketing master" (architecture §3). The system
 * seed is STABLE across every turn so it caches as a prefix; the volatile
 * account context (the internal data + the question) goes in the user message.
 * This is the internal-first principle made concrete: the model is handed the
 * connected-account data and told to ground every claim in it.
 */
const SYSTEM_SEED = `You are Marpin, a senior performance-marketing analyst embedded in the user's marketing stack. You are fluent across paid search (Google Ads), paid social (Meta, TikTok, LinkedIn), SEO and Search Console, and GA4 analytics, and you reason about spend, ROAS, CPA, CAC, funnel conversion and attribution like a seasoned growth operator.

Operating rules:
- Internal data first. Call the get_account_metrics tool to read the user's connected-account data before answering, and ground every number and claim in what it returns; never invent or estimate a metric the tool did not provide.
- Lead with the decision. Open with the single most important insight and its € impact, then the recommended action. The interface renders the supporting charts and tables, so synthesize — do not restate every figure.
- Be concise and concrete: 2–3 sentences, plain language a non-expert founder understands. No preamble, no hedging, no bullet lists. Plain prose only — no markdown, asterisks, bold, or headings.
- Money-moving actions are proposals only. Never claim you have already changed a budget, paused a campaign, or launched anything.`;

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
Account question: ${input.question}

Use get_account_metrics to read the account data, then write only the lead paragraph (2–3 sentences) for this answer, grounded in what the tool returns.`;
  return { system: SYSTEM_SEED, userContent };
}
