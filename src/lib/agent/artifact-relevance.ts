import type { ArtifactKind } from "@/lib/streaming/events";

const URL_LIKE = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|ai|io|co|net|org|app|dev)\b/i;

const INTENT: Partial<Record<ArtifactKind, RegExp>> = {
  brief: /\b(brief|strategy|plan|campaign|content|launch|position(?:ing)?|brand|audience|offer|messaging|roadmap|distribution)\b/i,
  marketScan: /\b(market|competitor|competitive|position(?:ing)?|category|share|landscape|alternative|research)\b/i,
  rootCause: /\b(why|cause|diagnos|drop|declin|increase|rising|worse|underperform|problem|issue|investigate|explain)\b/i,
  recommendations: /\b(audit|website|site|seo|technical|funnel|landing|page|conversion|fix|improve|speed|content gap)\b/i,
  actionPlan: /\b(plan|strategy|launch|write|create|draft|post|publish|campaign|content|schedule|calendar|grow|seo|fix|roadmap|execute|distribution)\b/i,
  campaign: /\b(ad|ads|campaign|paid|google|meta|tiktok|budget|targeting|creative)\b/i,
  kpis: /\b(kpi|metric|performance|result|roas|cpa|ctr|cvr|spend|revenue|conversion)\b/i,
  chart: /\b(trend|chart|over time|history|performance|metric)\b/i,
  leaks: /\b(waste|leak|inefficien|spend|budget|roas|cpa)\b/i,
  funnel: /\b(funnel|conversion|journey|drop.off|checkout|lead)\b/i,
  platformComparison: /\b(compare|comparison|channel|platform|google|meta|tiktok)\b/i,
  healthVerdict: /\b(health|performance|account|audit|tracking)\b/i,
  trackingHealth: /\b(track|tracking|analytics|pixel|tag|measurement|attribution)\b/i,
  forecastResult: /\b(forecast|project|scenario|what if|budget)\b/i,
  planAllocation: /\b(allocate|allocation|budget|media plan|channel mix)\b/i,
};

/**
 * Last server-side guard between model-selected cards and the public canvas.
 * Every card requires an intent signal. A supplied URL additionally makes a
 * market/audit/action workspace reasonable, but never permits unrelated cards.
 */
export function isArtifactRelevant(question: string, kind: ArtifactKind): boolean {
  const normalized = question.trim();
  if (!normalized) return false;
  const matcher = INTENT[kind];
  if (matcher?.test(normalized)) return true;
  if (URL_LIKE.test(normalized)) {
    return kind === "marketScan" || kind === "recommendations" || kind === "actionPlan";
  }
  return false;
}
