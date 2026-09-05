import type { MetaCampaignSnapshotV1, MetaPausedDeliveryV1, PaidCampaignSnapshotV1 } from "./types";
import { PaidDraftValidationError } from "./validation";

export const META_PAUSED_COUNTRIES = {
  ES: "Spain", FR: "France", DE: "Germany", IT: "Italy", PT: "Portugal",
  GB: "United Kingdom", US: "United States", CA: "Canada", AU: "Australia",
  NL: "Netherlands", BE: "Belgium", IE: "Ireland", AT: "Austria", CH: "Switzerland",
} as const;

export type MetaPausedSnapshot = MetaCampaignSnapshotV1 & { readonly metaDelivery: MetaPausedDeliveryV1 };
export interface MetaPausedIssue { code: string; path: string; message: string }

/** Every unsupported field blocks delivery; no silent targeting or budget changes. */
export function metaPausedIssues(snapshot: PaidCampaignSnapshotV1): MetaPausedIssue[] {
  const issues: MetaPausedIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  if (snapshot.platform !== "meta_ads") {
    add("unsupported_platform", "platform", "Direct paused creation is available for Meta only.");
    return issues;
  }
  if (!snapshot.metaDelivery) add("delivery_missing", "metaDelivery", "Choose a Facebook Page and confirm delivery settings.");
  if (snapshot.template !== "meta_traffic" || snapshot.campaign.objective !== "traffic") {
    add("unsupported_objective", "template", "Direct creation currently supports traffic to a website or App Store link, not app-install tracking or lead forms.");
  }
  if (!["EUR", "USD", "GBP", "CAD", "AUD"].includes(snapshot.budget.currency)) {
    add("unsupported_currency", "budget.currency", "Direct creation currently supports EUR, USD, GBP, CAD and AUD.");
  }
  if (snapshot.adGroups.length !== 1) add("unsupported_groups", "adGroups", "Use one audience so the total approved budget is not multiplied across ad sets.");
  snapshot.adGroups.forEach((group, index) => {
    const prefix = `adGroups[${index}]`;
    if (group.ads.length > 3) add("too_many_ads", `${prefix}.ads`, "Direct creation supports up to three image ads in one audience.");
    if (group.targeting.locations.some((country) => !Object.hasOwn(META_PAUSED_COUNTRIES, country))) {
      add("unresolved_country", `${prefix}.targeting.locations`, "Select supported countries in delivery settings. Free-text locations cannot be sent to Meta.");
    }
    if (group.targeting.languages.length !== 1 || group.targeting.languages[0] !== "All languages") {
      add("unresolved_language", `${prefix}.targeting.languages`, "Direct creation currently requires All languages. Your ad copy keeps its original language.");
    }
    if (group.targeting.interests.length) add("unresolved_interests", `${prefix}.targeting.interests`, "Direct creation currently uses a broad audience. Remove interests or use manual preparation.");
    if (group.targeting.ageMin < 18) add("unsupported_age", `${prefix}.targeting.ageMin`, "Direct creation supports adult audiences only.");
    group.ads.forEach((ad, adIndex) => {
      if (ad.format !== "image") add("unsupported_format", `${prefix}.ads[${adIndex}].format`, "Direct creation currently supports JPG or PNG images. Videos remain manual preparation.");
    });
  });
  return issues;
}

export function assertMetaPausedSnapshot(snapshot: PaidCampaignSnapshotV1): asserts snapshot is MetaPausedSnapshot {
  const issue = metaPausedIssues(snapshot)[0];
  if (issue) throw new PaidDraftValidationError(issue.code, issue.message, issue.path);
}
