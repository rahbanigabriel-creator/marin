import type { BrandPromptContext } from "@/lib/brand/types";

/** Honest deterministic recovery copy when Brand memory is already available. */
export function buildOfflineBrandLead(
  question: string,
  brand: BrandPromptContext,
  orient?: string | null,
): string {
  const normalized = question.toLowerCase();
  const audience = brand.audience[0] || "its target audience";
  const offer = brand.offers[0] || brand.summary || "its core offer";
  const voice = brand.voice.slice(0, 2).join(" and ") || "established";

  if (/paid|campaign|google ads|meta ads|tiktok ads/.test(normalized)) {
    return `For ${brand.name}, anchor the campaign on ${offer} for ${audience}, then separate the creative test, audience test, and landing-page test so each result is interpretable. I'll use the saved ${brand.currency} and ${brand.locale} context; the remaining inputs are target geography, objective, and approved budget.`;
  }
  if (/organic|social|content|post|calendar|\bweek\b|\bmonth\b/.test(normalized)) {
    return `For ${brand.name}, build the week around one founder insight tied to ${offer} for ${audience}, then adapt it into a proof-led post, a short video, and a community conversation. I'll keep the work ${voice} and use the saved ${brand.locale} / ${brand.timezone} context; choose the priority channels and weekly publishing capacity to turn it into a review-ready calendar.`;
  }
  if (/seo|audit|website|landing|funnel/.test(normalized)) {
    return `I already have ${brand.name}'s website and corrected Brand memory, so you do not need to repeat the business context. Start by matching the highest-intent page to ${audience}, making ${offer} unmistakable above the fold, and then prioritize the technical and content findings by impact.`;
  }
  return `${orient ? `${orient} ` : ""}I already have ${brand.name}'s website, positioning, audience, and voice in Brand memory, so you do not need to repeat them. I'll use that corrected context as the source of truth for this answer.`;
}
