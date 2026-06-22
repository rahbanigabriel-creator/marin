import type { AnswerData } from "@/types/artifacts";
import type { Channel, RecentChat } from "@/types/views";

/**
 * Canonical source-of-truth data, transcribed verbatim from the design handoff
 * (AnswerCanvas.dc.html + README). In the real product this shape is produced
 * by querying connected platforms; here it backs the streaming demo and acts as
 * the mock-provider fallback.
 */

export const LEAD_TEXT =
  "You're leaking roughly €11.5k per month, concentrated in three campaigns running well under a 2× ROAS. Here's the breakdown — and I've already drafted the fixes.";

export const DEFAULT_QUESTION =
  "Where am I wasting ad spend this month across Google and Meta — and what should I do about it?";

export const RECENT_CHATS: RecentChat[] = [
  { title: "Wasted ad spend audit", question: DEFAULT_QUESTION },
  {
    title: "TikTok creative test plan",
    question:
      "Design a TikTok creative test plan for next month — hooks, formats, and budget split.",
  },
  {
    title: "Branded search efficiency",
    question:
      "Is my branded search spend efficient, or am I paying for clicks I'd win organically?",
  },
  {
    title: "GA4 path attribution",
    question:
      "Walk me through the top GA4 conversion paths and where attribution credit is going.",
  },
  {
    title: "Holiday budget plan",
    question: "Build a holiday-season budget plan across Google, Meta, and TikTok.",
  },
];

export const SUGGESTIONS = [
  "Which platform is performing best?",
  "Is my marketing working — should I cut or raise budget?",
  "Why is my CPA going up?",
  "Do I have a tracking problem?",
];

export const DEFAULT_CHANNELS: Channel[] = [
  { name: "Google Ads", status: "connected" },
  { name: "Meta Ads", status: "connected" },
  { name: "GA4", status: "connected" },
  { name: "Search Console", status: "connected" },
  { name: "TikTok Ads", status: "disconnected" },
  { name: "LinkedIn Ads", status: "disconnected" },
];

/** Platform brand swatch colors (placeholders) for the connections modal. */
export const PLATFORM_ICON_COLORS: Record<string, string> = {
  "Google Ads": "#4285F4",
  "Meta Ads": "#1877F2",
  GA4: "#E8710A",
  "Apple Search Ads": "#2B2722",
  "Search Console": "#5E7B52",
  "TikTok Ads": "#2B2722",
  "LinkedIn Ads": "#0A66C2",
};

export const WORKSPACE_LABEL = "Northwind workspace";

export const CANONICAL_ANSWER: AnswerData = {
  lead: LEAD_TEXT,
  chips: [
    { label: "€11.5k/mo at risk", tone: "bad" },
    { label: "€7.7k recoverable", tone: "good" },
    { label: "3 fixes ready", tone: "neutral" },
    { label: "1 campaign drafted", tone: "clay" },
  ],
  kpis: [
    {
      label: "Spend",
      value: "€48.2k",
      delta: "+12%",
      tone: "neutral",
      sparkColor: "#A8997C",
      spark: [38, 40, 39, 42, 44, 43, 46, 48],
    },
    {
      label: "ROAS",
      value: "3.8×",
      delta: "−9%",
      tone: "bad",
      sparkColor: "#B23A4B",
      spark: [4.3, 4.2, 4.1, 4.0, 3.9, 3.7, 3.6, 3.4],
    },
    {
      label: "CPA",
      value: "€31.40",
      delta: "+18%",
      tone: "bad",
      sparkColor: "#B23A4B",
      spark: [24, 25, 26, 27, 28, 30, 30, 31],
    },
    {
      label: "Conversions",
      value: "1,540",
      delta: "+6%",
      tone: "good",
      sparkColor: "#5E7B52",
      spark: [1.3, 1.35, 1.4, 1.42, 1.48, 1.5, 1.52, 1.54],
    },
  ],
  chart: {
    title: "Spend & ROAS",
    sub: "Daily, last 14 days · all channels",
    spend: [3.1, 3.4, 3.0, 3.6, 4.1, 3.9, 3.2, 3.5, 4.4, 4.0, 3.7, 4.6, 4.2, 4.8],
    roas: [4.2, 4.1, 4.3, 4.0, 3.9, 4.1, 3.8, 3.7, 3.9, 3.6, 3.5, 3.7, 3.4, 3.3],
  },
  leaks: {
    total: "€11,550 / mo",
    items: [
      { channel: "Search", name: "Generic — Broad", wasted: 4210, roas: "0.9×" },
      { channel: "Display", name: "Audience Expansion", wasted: 3540, roas: "0.6×" },
      { channel: "Meta", name: "Retargeting — Broad", wasted: 2680, roas: "1.4×" },
      { channel: "Search", name: "Brand Defense", wasted: 1120, roas: "2.1×" },
    ],
  },
  funnel: {
    stages: [
      { label: "Impressions", value: "2.41M", widthPct: 100, rate: "", color: "#C8A9B8" },
      { label: "Clicks", value: "86.2k", widthPct: 64, rate: "3.6% CTR", color: "#BE8DA4" },
      { label: "Sessions", value: "71.4k", widthPct: 52, rate: "83% landed", color: "#B06487" },
      { label: "Add to cart", value: "9.2k", widthPct: 28, rate: "12.9%", color: "#9A3D63" },
      { label: "Purchases", value: "1,540", widthPct: 14, rate: "16.7% CVR", color: "#7E2F50" },
    ],
  },
  recommendations: {
    items: [
      {
        id: "rec-pause-display",
        tag: "Quick win",
        title: "Pause Display · Audience Expansion",
        body: "0.6× ROAS over 30 days with no assisted conversions. Safe to pause now.",
        impact: "+€3,540 / mo",
      },
      {
        id: "rec-reallocate-tiktok",
        tag: "Growth",
        title: "Reallocate €5k to TikTok Prospecting",
        body: "Lookalike 2% beats Meta retargeting on blended CAC by 38%.",
        impact: "proj. 4.2× ROAS",
      },
      {
        id: "rec-negative-keywords",
        tag: "Cleanup",
        title: "Add 18 negative keywords to Generic — Broad",
        body: "Campaign matches irrelevant queries. Tighten to phrase match.",
        impact: "+€1,120 / mo",
      },
    ],
  },
  campaign: {
    title: "Campaign drafted · TikTok Prospecting — Summer",
    sub: "Ready to launch · built from reallocated budget",
    spec: {
      objective: "Conversions",
      budget: "€5,000",
      audience: "Lookalike 2% + Interest",
      estRoas: "4.2×",
    },
    creatives: ["9:16 · A", "9:16 · B", "9:16 · C"],
    explainer:
      "3 vertical variants generated from your top-performing static. Hooks A/B tested against your retargeting copy.",
  },
  closing: {
    split:
      "I drafted a **TikTok Prospecting** campaign to absorb the reallocated budget. Review it in the workspace →",
    thread:
      "That recovers about **€7.7k/month** with no loss in conversions. Approve the actions above and I'll push them to each platform.",
  },
};
