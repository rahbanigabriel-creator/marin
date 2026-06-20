import type { Scenario } from "@/types/scenario";
import type { ArtifactPayload } from "@/lib/streaming/events";
import { CANONICAL_ANSWER, DEFAULT_QUESTION } from "@/lib/data/canonical";
import { project } from "@/lib/forecast/project";

/** The canonical founder audit, expressed as an ordered artifact list. */
function founderArtifacts(): ArtifactPayload[] {
  return [
    { kind: "kpis", data: CANONICAL_ANSWER.kpis },
    { kind: "chart", data: CANONICAL_ANSWER.chart },
    { kind: "leaks", data: CANONICAL_ANSWER.leaks },
    { kind: "funnel", data: CANONICAL_ANSWER.funnel },
    { kind: "recommendations", data: CANONICAL_ANSWER.recommendations },
    { kind: "campaign", data: CANONICAL_ANSWER.campaign },
  ];
}

/**
 * The canned scenario library. Founder = the original canonical audit; one or
 * two signature scenarios per other persona, each composing a different artifact
 * sequence. Slice 2 splits these into per-persona dataset modules.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: "founder:default",
    persona: "founder",
    title: "Wasted ad spend audit",
    question: DEFAULT_QUESTION,
    keywords: ["wasting", "waste", "wasted", "spend", "leak", "leaking", "audit"],
    lead: CANONICAL_ANSWER.lead,
    chips: CANONICAL_ANSWER.chips,
    artifacts: founderArtifacts(),
    closing: CANONICAL_ANSWER.closing,
  },

  {
    id: "cmo:compare",
    persona: "cmo",
    title: "Which platform is winning",
    question: "Which platform is performing best?",
    keywords: ["platform", "compare", "comparison", "which platform", "best", "google vs", "meta vs", "tiktok", "channel"],
    lead:
      "Google is carrying you — 4.6× ROAS at the lowest CPA. Meta is slipping and TikTok hasn't earned its budget yet. Here's the head-to-head.",
    chips: [
      { label: "Google 4.6× ROAS", tone: "good" },
      { label: "Meta −18% MoM", tone: "bad" },
      { label: "€5k to reallocate", tone: "clay" },
    ],
    artifacts: [
      { kind: "kpis", data: CANONICAL_ANSWER.kpis },
      {
        kind: "platformComparison",
        data: {
          title: "Platform performance",
          sub: "Last 30 days · blended",
          rows: [
            { platform: "Google Ads", color: "#4285F4", spend: "€22.4k", roas: "4.6×", roasValue: 4.6, cpa: "€24.10", verdict: "best" },
            { platform: "Meta Ads", color: "#1877F2", spend: "€18.9k", roas: "3.1×", roasValue: 3.1, cpa: "€38.50", verdict: "watch" },
            { platform: "TikTok Ads", color: "#2B2722", spend: "€6.9k", roas: "2.2×", roasValue: 2.2, cpa: "€41.80", verdict: "cut" },
          ],
        },
      },
    ],
    closing: {
      split: "Want me to draft the €5k shift from Meta to Google?",
      thread: "Net: shift budget toward Google. Approve and I'll rebalance.",
    },
  },

  {
    id: "ceo:health",
    persona: "ceo",
    title: "Is marketing working?",
    question: "Is my marketing working — should I cut or raise budget?",
    keywords: ["working", "cut", "raise", "budget", "worth", "scale", "healthy", "marketing working"],
    lead:
      "Short answer: yes. You're generating €4.10 for every €1 spent and payback is under a quarter — there's room to push.",
    chips: [
      { label: "€612k revenue", tone: "good" },
      { label: "4.1× blended MER", tone: "good" },
      { label: "Raise budget", tone: "clay" },
    ],
    artifacts: [
      {
        kind: "healthVerdict",
        data: {
          status: "healthy",
          headline: "Marketing is working — lean in.",
          sub: "Profitable on a blended basis with headroom to scale.",
          metrics: [
            { label: "Revenue (30d)", value: "€612k", tone: "good" },
            { label: "Blended MER", value: "4.1×", tone: "good" },
            { label: "CAC payback", value: "2.3 mo", tone: "good" },
          ],
          recommendation: "Raise budget ~15% on Google; hold Meta until CPA recovers.",
        },
      },
      { kind: "kpis", data: CANONICAL_ANSWER.kpis },
      { kind: "forecastResult", data: project(60000) },
    ],
    closing: {
      split: "I can model a 15% budget increase — want the forecast?",
      thread: "Recommendation: raise budget ~15%. Approve to proceed.",
    },
  },

  {
    id: "agency:why",
    persona: "agency",
    title: "Why is CPA rising?",
    question: "Why is my CPA going up?",
    keywords: ["why", "cpa", "going up", "rising", "increase", "increasing", "worse"],
    lead:
      "Your CPA is up 18%, but the auction is calm — this is a conversion problem, not a cost problem. It traces back to a mobile site change on Aug 3.",
    chips: [
      { label: "CPA +18%", tone: "bad" },
      { label: "Mobile CVR −14%", tone: "bad" },
      { label: "Fixable", tone: "good" },
    ],
    artifacts: [
      { kind: "kpis", data: CANONICAL_ANSWER.kpis },
      {
        kind: "rootCause",
        data: {
          metric: "CPA",
          change: "+18%",
          tone: "bad",
          summary:
            "CPA rose €4.80 in 30 days. CPC is flat — the driver is a mobile conversion-rate drop after the Aug 3 site update.",
          drivers: [
            { label: "Click cost is flat", detail: "CPC +2% — the auction is stable", impact: "≈ €0" },
            { label: "Mobile conversion rate fell", detail: "Mobile CVR −14% right after the Aug 3 release", impact: "+€3.90 CPA" },
            { label: "Landing-page speed regressed", detail: "Mobile LCP went 1.2s → 3.1s", impact: "+€0.90 CPA" },
          ],
        },
      },
    ],
    closing: {
      split: "Want me to flag this to the dev team with the LCP trace?",
      thread: "Root cause: the Aug 3 change tanked mobile CVR. Fix landing-page speed first.",
    },
  },

  {
    id: "agency:tracking",
    persona: "agency",
    title: "Tracking health check",
    question: "Do I have a tracking problem?",
    keywords: ["tracking", "pixel", "attribution", "conversion tracking", "broken", "ga4", "tag", "misreport"],
    lead:
      "Found it — your Meta Pixel is dropping ~31% of mobile purchases, so Meta looks worse than it actually is. Two fixes recover the reporting.",
    chips: [
      { label: "2 issues", tone: "bad" },
      { label: "Meta Pixel gap", tone: "bad" },
      { label: "31% under-reported", tone: "clay" },
    ],
    artifacts: [
      {
        kind: "trackingHealth",
        data: {
          title: "Tracking health",
          summary: "2 issues are under-reporting your conversions.",
          checks: [
            { label: "Google Ads conversion tag", status: "pass", detail: "Firing on all purchase events" },
            { label: "Meta Pixel — Purchase", status: "fail", detail: "Missing on 31% of mobile checkouts since Aug 3" },
            { label: "GA4 ↔ Google Ads link", status: "warn", detail: "Imported conversions lag 36–48h" },
            { label: "UTM consistency", status: "pass", detail: "Campaign parameters are well-formed" },
            { label: "Enhanced conversions", status: "warn", detail: "Off for Meta — enable for better matching" },
          ],
        },
      },
    ],
    closing: {
      split: "Want the exact fix steps for the Meta Pixel?",
      thread: "Priority: restore the Meta Pixel purchase event. I can generate the fix.",
    },
  },
];
