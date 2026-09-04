import type { BrandPromptContext } from "@/lib/brand/types";

/** Honest deterministic recovery copy when saved audit context is available. */
export function buildOfflineBrandLead(
  question: string,
  brand: BrandPromptContext,
  orient?: string | null,
): string {
  const normalized = question.toLowerCase();
  const audience = brand.audience[0] || "its target audience";
  const offer = brand.offers[0] || brand.summary || "its core offer";
  const voice = brand.voice.slice(0, 2).join(" and ") || "established";
  const wantsPaid = /paid|campaign|google ads|meta ads|tiktok ads/.test(normalized);
  const wantsOrganic = /organic|social|content|post|calendar|\bweek\b|\bmonth\b/.test(normalized);
  const wantsSeo = /seo|audit|website|landing|funnel/.test(normalized);
  const requestedAreas = [wantsOrganic, wantsSeo, wantsPaid].filter(Boolean).length;

  if (requestedAreas > 1) {
    const actions: string[] = [];
    if (wantsOrganic) {
      actions.push(
        `Organic: turn ${offer} into one proof-led post, one short video, and one community prompt for ${audience}, then schedule the strongest three across the priority channels.`,
      );
    }
    if (wantsSeo) {
      actions.push(
        brand.websiteUrl?.includes("apps.apple.com")
          ? "SEO: treat the App Store listing as ASO context, improve its controllable title, subtitle, keywords, screenshots, and description, and audit a first-party product site separately for technical SEO."
          : `SEO: match the highest-intent page to ${audience}, make ${offer} unmistakable above the fold, and work the evidence-backed audit tasks in priority order.`,
      );
    }
    if (wantsPaid) {
      actions.push(
        `Paid: prepare separate Google Ads intent and Meta Ads creative tests around ${offer}, with one audience variable and one creative variable per test; approve geography, objective, and budget before launch.`,
      );
    }
    return actions.join(" ");
  }

  if (wantsPaid) {
    return `For ${brand.name}, anchor the campaign on ${offer} for ${audience}, then separate the creative test, audience test, and landing-page test so each result is interpretable. I'll use the saved ${brand.currency} and ${brand.locale} context; the remaining inputs are target geography, objective, and approved budget.`;
  }
  if (wantsOrganic) {
    return `For ${brand.name}, build the week around one founder insight tied to ${offer} for ${audience}, then adapt it into a proof-led post, a short video, and a community conversation. I'll keep the work ${voice} and use the saved ${brand.locale} / ${brand.timezone} context; choose the priority channels and weekly publishing capacity to turn it into a review-ready calendar.`;
  }
  if (wantsSeo) {
    return `I already have ${brand.name}'s website and saved audit context, so you do not need to repeat the business details. Start by matching the highest-intent page to ${audience}, making ${offer} unmistakable above the fold, and then prioritize the technical and content findings by impact.`;
  }
  return `${orient ? `${orient} ` : ""}I already have ${brand.name}'s website, positioning, audience, and voice in the saved audit context, so you do not need to repeat them. I'll use that corrected context as the source of truth for this answer.`;
}
