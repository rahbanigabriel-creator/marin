import type { Scenario } from "@/types/scenario";
import type { KpiCardData } from "@/types/artifacts";
import type { ArtifactPayload } from "@/lib/streaming/events";
import type { ClientAccount } from "@/lib/data/clients";
import { CANONICAL_ANSWER } from "@/lib/data/canonical";

function parseEur(s: string): number {
  const m = s.replace(/[€,\s]/g, "");
  return m.endsWith("k") ? parseFloat(m) * 1000 : parseFloat(m) || 0;
}

/** Per-client KPI row built from the roster numbers, so the client's data carries through. */
function clientKpis(c: ClientAccount): KpiCardData[] {
  const conv = parseEur(c.cpa) ? Math.round(parseEur(c.spend) / parseEur(c.cpa)) : 0;
  const healthy = c.status === "healthy";
  return [
    { label: "Spend", value: c.spend, delta: "+6%", tone: "neutral", sparkColor: "#A8997C", spark: [40, 41, 42, 43, 44, 45, 46, 48] },
    {
      label: "ROAS",
      value: c.roas,
      delta: healthy ? "+4%" : "−7%",
      tone: healthy ? "good" : "bad",
      sparkColor: healthy ? "#5E7B52" : "#B23A4B",
      spark: healthy ? [3.5, 3.6, 3.7, 3.8, 3.9, 4.0, 4.05, 4.1] : [4.3, 4.2, 4.0, 3.9, 3.7, 3.5, 3.4, 3.3],
    },
    {
      label: "CPA",
      value: c.cpa,
      delta: healthy ? "−5%" : "+18%",
      tone: healthy ? "good" : "bad",
      sparkColor: healthy ? "#5E7B52" : "#B23A4B",
      spark: healthy ? [35, 34, 33, 32, 31, 30, 29, 28] : [24, 25, 26, 27, 28, 30, 30, 31],
    },
    { label: "Conversions", value: conv.toLocaleString("en-US"), delta: "+5%", tone: "good", sparkColor: "#5E7B52", spark: [1.3, 1.35, 1.4, 1.42, 1.48, 1.5, 1.52, 1.54] },
  ];
}

/** The headline diagnostic artifact for the client, by their flagged issue. */
function issueArtifacts(c: ClientAccount): ArtifactPayload[] {
  const q = c.question.toLowerCase();
  if (q.includes("tracking")) {
    return [
      {
        kind: "trackingHealth",
        data: {
          title: `${c.name} · Tracking health`,
          summary: c.alert ? `${c.alert}.` : "Conversion tracking checks across pixels, tags and attribution.",
          checks: [
            { label: "Google Ads conversion tag", status: "pass", detail: "Firing on all purchase events" },
            { label: "Meta Pixel — Purchase", status: "fail", detail: "Missing on 31% of mobile checkouts" },
            { label: "GA4 ↔ Google Ads link", status: "warn", detail: "Imported conversions lag 36–48h" },
            { label: "UTM consistency", status: "pass", detail: "Campaign parameters are well-formed" },
          ],
        },
      },
    ];
  }
  if (q.includes("platform")) {
    return [
      {
        kind: "platformComparison",
        data: {
          title: "Platform performance",
          sub: `${c.name} · last 30 days`,
          rows: [
            { platform: "Google Ads", color: "#4285F4", spend: "€22.4k", roas: "4.6×", roasValue: 4.6, cpa: "€24.10", verdict: "best" },
            { platform: "Meta Ads", color: "#1877F2", spend: "€18.9k", roas: "3.1×", roasValue: 3.1, cpa: "€38.50", verdict: "watch" },
            { platform: "TikTok Ads", color: "#2B2722", spend: "€6.9k", roas: "2.2×", roasValue: 2.2, cpa: "€41.80", verdict: "cut" },
          ],
        },
      },
    ];
  }
  if (q.includes("cpa") || q.includes("why")) {
    return [
      {
        kind: "rootCause",
        data: {
          metric: "CPA",
          change: "+18%",
          tone: "bad",
          summary: `${c.name}'s CPA climbed to ${c.cpa}. The auction is stable — this is a conversion problem, not a cost problem.`,
          drivers: [
            { label: "Click cost is flat", detail: "CPC +2% — the auction is stable", impact: "≈ €0" },
            { label: "Mobile conversion rate fell", detail: "Mobile CVR −14% after a recent site change", impact: "+€3.90 CPA" },
            { label: "Landing-page speed regressed", detail: "Mobile LCP went 1.2s → 3.1s", impact: "+€0.90 CPA" },
          ],
        },
      },
    ];
  }
  // default: a spend audit
  return [
    { kind: "leaks", data: CANONICAL_ANSWER.leaks },
    { kind: "funnel", data: CANONICAL_ANSWER.funnel },
  ];
}

/** Build a client-scoped scenario from a roster account (front-end, canned). */
export function buildClientScenario(c: ClientAccount): Scenario {
  const healthy = c.status === "healthy";
  const lead = healthy
    ? `${c.name} is healthy — ${c.roas} ROAS at ${c.cpa} CPA on ${c.spend}/mo. Here's the latest read.`
    : `${c.name}: ${c.alert}. Here's what's driving it and what I'd do.`;

  return {
    id: `client:${c.id}`,
    persona: "agency",
    title: c.name,
    question: c.question,
    keywords: [],
    lead,
    chips: [
      { label: healthy ? "Healthy" : "Needs attention", tone: healthy ? "good" : "bad" },
      { label: `${c.roas} ROAS`, tone: "neutral" },
      { label: `${c.spend}/mo`, tone: "clay" },
    ],
    artifacts: [{ kind: "kpis", data: clientKpis(c) }, ...issueArtifacts(c)],
    closing: {
      split: `Want me to draft the fix for ${c.name}?`,
      thread: `Approve and I'll apply the fix to ${c.name} and notify the client.`,
    },
  };
}
