import type { ContentAssetDto } from "@/lib/content/types";
import type {
  PaidCampaignSnapshotV1,
  PaidDraftSource,
  PaidLaunchTemplate,
  PaidPlatform,
  SocialCallToAction,
  SocialGender,
  MetaPausedDeliveryV1,
} from "@/lib/paid-drafts/types";
import {
  PaidDraftValidationError,
  parsePaidCampaignSnapshotV1,
} from "@/lib/paid-drafts/validation";
import { calendarDateKey, wallClockFromIso, zonedDateTimeToIso } from "@/lib/time/zoned";

export interface PaidConnectionOption {
  id: string;
  platform: PaidPlatform;
  accountId: string;
  accountName: string;
  currency: string | null;
  timezone: string | null;
}

export interface PaidDraftAdForm {
  localId: string;
  name: string;
  assetId: string;
  format: "image" | "video";
  primaryText: string;
  headline: string;
  description: string;
  callToAction: SocialCallToAction;
  destinationUrl: string;
  headlines: string;
  descriptions: string;
  path1: string;
  path2: string;
}

export interface PaidDraftAdGroupForm {
  localId: string;
  name: string;
  locations: string;
  languages: string;
  keywords: string;
  negativeKeywords: string;
  ageMin: string;
  ageMax: string;
  genders: SocialGender[];
  interests: string;
  ads: PaidDraftAdForm[];
}

export interface PaidDraftFormValue {
  metaDelivery?: MetaPausedDeliveryV1;
  metaCategoryConfirmed?: boolean;
  source: PaidDraftSource;
  connection: PaidConnectionOption;
  template: PaidLaunchTemplate;
  campaignName: string;
  budgetMajor: string;
  currency: string;
  cadence: "daily" | "lifetime";
  timezone: string;
  startsDate: string;
  startsTime: string;
  endsDate: string;
  endsTime: string;
  assumptions: string;
  adGroups: PaidDraftAdGroupForm[];
}

export interface PaidDraftFormIssue {
  path: string;
  message: string;
}

const TEMPLATE_PLATFORM: Record<PaidLaunchTemplate, PaidPlatform> = {
  google_search_rsa: "google_ads",
  meta_traffic: "meta_ads",
  meta_lead: "meta_ads",
  tiktok_traffic: "tiktok_ads",
  tiktok_conversion: "tiktok_ads",
};

export const TEMPLATE_LABEL: Record<PaidLaunchTemplate, string> = {
  google_search_rsa: "Google Search · responsive search ad",
  meta_traffic: "Meta · traffic",
  meta_lead: "Meta · lead generation",
  tiktok_traffic: "TikTok · traffic",
  tiktok_conversion: "TikTok · conversions",
};

export const PLATFORM_LABEL: Record<PaidPlatform, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  tiktok_ads: "TikTok Ads",
};

export const CALL_TO_ACTION_LABEL: Record<SocialCallToAction, string> = {
  contact_us: "Contact us",
  download: "Download",
  learn_more: "Learn more",
  shop_now: "Shop now",
  sign_up: "Sign up",
};

export const CALL_TO_ACTIONS = Object.keys(CALL_TO_ACTION_LABEL) as SocialCallToAction[];

function localId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replaceAll("-", "").slice(0, 16)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${random}`;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

function defaultAd(): PaidDraftAdForm {
  return {
    localId: localId("ad"),
    name: "",
    assetId: "",
    format: "image",
    primaryText: "",
    headline: "",
    description: "",
    callToAction: "learn_more",
    destinationUrl: "",
    headlines: "",
    descriptions: "",
    path1: "",
    path2: "",
  };
}

export function createPaidDraftAdGroup(): PaidDraftAdGroupForm {
  return {
    localId: localId("group"),
    name: "",
    locations: "",
    languages: "English",
    keywords: "",
    negativeKeywords: "",
    ageMin: "18",
    ageMax: "65",
    genders: ["all"],
    interests: "",
    ads: [defaultAd()],
  };
}

export function createPaidDraftAd(): PaidDraftAdForm {
  return defaultAd();
}

export function templatesForPlatform(platform: PaidPlatform): PaidLaunchTemplate[] {
  return (Object.keys(TEMPLATE_PLATFORM) as PaidLaunchTemplate[]).filter(
    (template) => TEMPLATE_PLATFORM[template] === platform,
  );
}

export function createPaidDraftForm(
  connection: PaidConnectionOption,
  template: PaidLaunchTemplate = templatesForPlatform(connection.platform)[0],
  now = new Date(),
): PaidDraftFormValue {
  const timezone = connection.timezone || "UTC";
  const today = calendarDateKey(now, timezone);
  return {
    source: "manual",
    connection,
    template,
    campaignName: "",
    budgetMajor: "",
    currency: connection.currency || "",
    cadence: "daily",
    timezone,
    startsDate: addDays(today, 1),
    startsTime: "09:00",
    endsDate: addDays(today, 8),
    endsTime: "23:00",
    assumptions: connection.timezone
      ? ""
      : "Account timezone was unavailable; schedule drafted in UTC.",
    adGroups: [createPaidDraftAdGroup()],
  };
}

export function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function majorToMinor(value: string, currency: string): number {
  const normalized = value.trim();
  const fractionDigits = currencyFractionDigits(currency);
  const amountPattern = fractionDigits === 0
    ? /^\d+$/
    : new RegExp(`^\\d+(?:\\.\\d{1,${fractionDigits}})?$`);
  if (!amountPattern.test(normalized)) {
    throw new Error(`Budget must be a positive amount with no more than ${fractionDigits} decimal${fractionDigits === 1 ? "" : "s"}.`);
  }
  const [whole, fraction = ""] = normalized.split(".");
  const factor = 10 ** fractionDigits;
  const minor = Number(whole) * factor + Number(fraction.padEnd(fractionDigits, "0"));
  if (!Number.isSafeInteger(minor) || minor < 1) {
    throw new Error("Budget must be greater than zero.");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Currency must be a three-letter ISO code.");
  }
  return minor;
}

export function currencyFractionDigits(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Currency must be a three-letter ISO code.");
  }
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    throw new Error("Currency must be a supported ISO code.");
  }
}

function objectiveFor(template: PaidLaunchTemplate): "traffic" | "leads" | "conversions" {
  if (template === "meta_lead") return "leads";
  if (template === "tiktok_conversion") return "conversions";
  return "traffic";
}

function baseSnapshot(form: PaidDraftFormValue) {
  return {
    schemaVersion: 1 as const,
    source: form.source,
    platform: form.connection.platform,
    template: form.template,
    connection: {
      platform: form.connection.platform,
      connectionId: form.connection.id,
      accountId: form.connection.accountId,
      accountName: form.connection.accountName,
    },
    campaign: {
      name: form.campaignName,
      objective: objectiveFor(form.template),
    },
    budget: {
      amountMinor: majorToMinor(form.budgetMajor, form.currency),
      currency: form.currency,
      cadence: form.cadence,
    },
    schedule: {
      startsAt: zonedDateTimeToIso(form.startsDate, form.startsTime, form.timezone),
      endsAt: zonedDateTimeToIso(form.endsDate, form.endsTime, form.timezone),
      timezone: form.timezone,
    },
    assumptions: splitLines(form.assumptions),
  };
}

export function buildPaidCampaignSnapshot(form: PaidDraftFormValue): PaidCampaignSnapshotV1 {
  const base = baseSnapshot(form);
  if (form.connection.platform === "google_ads") {
    return parsePaidCampaignSnapshotV1({
      ...base,
      platform: "google_ads",
      template: "google_search_rsa",
      campaign: { ...base.campaign, objective: "traffic" },
      adGroups: form.adGroups.map((group) => ({
        localId: group.localId,
        name: group.name,
        targeting: {
          kind: "search",
          locations: splitLines(group.locations),
          languages: splitLines(group.languages),
          keywords: splitLines(group.keywords).map((keyword) => {
            const match = /^(broad|phrase|exact)\s*:\s*(.+)$/i.exec(keyword);
            return {
              text: match?.[2]?.trim() || keyword,
              matchType: (match?.[1]?.toLowerCase() || "phrase") as "broad" | "phrase" | "exact",
            };
          }),
          negativeKeywords: splitLines(group.negativeKeywords),
        },
        ads: group.ads.map((ad) => ({
          localId: ad.localId,
          name: ad.name,
          format: "responsive_search",
          assetIds: [],
          headlines: splitLines(ad.headlines),
          descriptions: splitLines(ad.descriptions),
          destinationUrl: ad.destinationUrl,
          path1: ad.path1.trim() || null,
          path2: ad.path2.trim() || null,
        })),
      })),
    });
  }
  const socialGroups = form.adGroups.map((group) => ({
    localId: group.localId,
    name: group.name,
    targeting: {
      kind: "audience" as const,
      locations: splitLines(group.locations),
      languages: splitLines(group.languages),
      ageMin: Number(group.ageMin),
      ageMax: Number(group.ageMax),
      genders: group.genders,
      interests: splitLines(group.interests),
    },
    ads: group.ads.map((ad) => ({
      localId: ad.localId,
      name: ad.name,
      format: form.connection.platform === "tiktok_ads" ? "video" as const : ad.format,
      assetIds: [ad.assetId],
      primaryText: ad.primaryText,
      headline: ad.headline,
      ...(form.connection.platform === "meta_ads"
        ? { description: ad.description.trim() || null }
        : {}),
      callToAction: ad.callToAction,
      destinationUrl: ad.destinationUrl,
    })),
  }));
  return parsePaidCampaignSnapshotV1({ ...base, adGroups: socialGroups, ...(form.connection.platform === "meta_ads" && form.metaDelivery ? { metaDelivery: form.metaDelivery } : {}) });
}

function requiredIssues(form: PaidDraftFormValue): PaidDraftFormIssue[] {
  const issues: PaidDraftFormIssue[] = [];
  if (form.metaDelivery && !form.metaCategoryConfirmed) issues.push({ path: "metaDelivery.specialAdCategory", message: "Confirm that no special ad category applies before preparing direct creation." });
  const required = (path: string, value: string, label: string) => {
    if (!value.trim()) issues.push({ path, message: `${label} is required.` });
  };
  required("campaign.name", form.campaignName, "Campaign name");
  required("budget.amountMinor", form.budgetMajor, "Budget");
  required("budget.currency", form.currency, "Currency");
  required("schedule.timezone", form.timezone, "Timezone");
  form.adGroups.forEach((group, groupIndex) => {
    const prefix = `adGroups[${groupIndex}]`;
    required(`${prefix}.name`, group.name, "Ad group name");
    required(`${prefix}.targeting.locations`, group.locations, "At least one location");
    required(`${prefix}.targeting.languages`, group.languages, "At least one language");
    if (form.connection.platform === "google_ads") {
      required(`${prefix}.targeting.keywords`, group.keywords, "At least one keyword");
    }
    group.ads.forEach((ad, adIndex) => {
      const adPrefix = `${prefix}.ads[${adIndex}]`;
      required(`${adPrefix}.name`, ad.name, "Ad name");
      required(`${adPrefix}.destinationUrl`, ad.destinationUrl, "Destination URL");
      if (form.connection.platform === "google_ads") {
        if (splitLines(ad.headlines).length < 3) {
          issues.push({ path: `${adPrefix}.headlines`, message: "Add at least three unique headlines." });
        }
        if (splitLines(ad.descriptions).length < 2) {
          issues.push({ path: `${adPrefix}.descriptions`, message: "Add at least two unique descriptions." });
        }
      } else {
        required(`${adPrefix}.assetIds`, ad.assetId, "Creative asset");
        required(`${adPrefix}.primaryText`, ad.primaryText, "Primary text");
        required(`${adPrefix}.headline`, ad.headline, "Headline");
      }
    });
  });
  return issues;
}

export function validatePaidDraftForm(form: PaidDraftFormValue): {
  snapshot: PaidCampaignSnapshotV1 | null;
  issues: PaidDraftFormIssue[];
} {
  const issues = requiredIssues(form);
  if (issues.length) return { snapshot: null, issues };
  try {
    return { snapshot: buildPaidCampaignSnapshot(form), issues: [] };
  } catch (error) {
    if (error instanceof PaidDraftValidationError) {
      return { snapshot: null, issues: [{ path: error.path, message: error.message }] };
    }
    return {
      snapshot: null,
      issues: [{ path: "snapshot", message: error instanceof Error ? error.message : "The draft is invalid." }],
    };
  }
}

function joinLines(values: readonly string[]): string {
  return values.join("\n");
}

export function formFromPaidDraft(snapshot: PaidCampaignSnapshotV1): PaidDraftFormValue {
  const start = wallClockFromIso(snapshot.schedule.startsAt, snapshot.schedule.timezone);
  const end = wallClockFromIso(snapshot.schedule.endsAt, snapshot.schedule.timezone);
  return {
    ...(snapshot.platform === "meta_ads" && snapshot.metaDelivery ? { metaDelivery: snapshot.metaDelivery, metaCategoryConfirmed: true } : {}),
    source: snapshot.source,
    connection: {
      id: snapshot.connection.connectionId,
      platform: snapshot.platform,
      accountId: snapshot.connection.accountId,
      accountName: snapshot.connection.accountName,
      currency: snapshot.budget.currency,
      timezone: snapshot.schedule.timezone,
    },
    template: snapshot.template,
    campaignName: snapshot.campaign.name,
    budgetMajor: (snapshot.budget.amountMinor / (10 ** currencyFractionDigits(snapshot.budget.currency)))
      .toFixed(currencyFractionDigits(snapshot.budget.currency)),
    currency: snapshot.budget.currency,
    cadence: snapshot.budget.cadence,
    timezone: snapshot.schedule.timezone,
    startsDate: start.date,
    startsTime: start.time,
    endsDate: end.date,
    endsTime: end.time,
    assumptions: joinLines(snapshot.assumptions),
    adGroups: snapshot.adGroups.map((group) => ({
      localId: group.localId,
      name: group.name,
      locations: joinLines(group.targeting.locations),
      languages: joinLines(group.targeting.languages),
      keywords: group.targeting.kind === "search"
        ? group.targeting.keywords.map((keyword) => `${keyword.matchType}: ${keyword.text}`).join("\n")
        : "",
      negativeKeywords: group.targeting.kind === "search"
        ? joinLines(group.targeting.negativeKeywords)
        : "",
      ageMin: group.targeting.kind === "audience" ? String(group.targeting.ageMin) : "18",
      ageMax: group.targeting.kind === "audience" ? String(group.targeting.ageMax) : "65",
      genders: group.targeting.kind === "audience" ? [...group.targeting.genders] : ["all"],
      interests: group.targeting.kind === "audience" ? joinLines(group.targeting.interests) : "",
      ads: group.ads.map((ad) => ({
        localId: ad.localId,
        name: ad.name,
        assetId: ad.assetIds[0] || "",
        format: ad.format === "image" ? "image" : "video",
        primaryText: "primaryText" in ad ? ad.primaryText : "",
        headline: "headline" in ad ? ad.headline : "",
        description: "description" in ad ? ad.description || "" : "",
        callToAction: "callToAction" in ad ? ad.callToAction : "learn_more",
        destinationUrl: ad.destinationUrl,
        headlines: "headlines" in ad ? joinLines(ad.headlines) : "",
        descriptions: "descriptions" in ad ? joinLines(ad.descriptions) : "",
        path1: "path1" in ad ? ad.path1 || "" : "",
        path2: "path2" in ad ? ad.path2 || "" : "",
      })),
    })),
  };
}

export function assetOptionsForPlatform(
  assets: readonly ContentAssetDto[],
  platform: PaidPlatform,
): ContentAssetDto[] {
  return platform === "tiktok_ads"
    ? assets.filter((asset) => asset.kind === "video")
    : assets.filter((asset) => asset.kind === "image" || asset.kind === "video");
}

export function paidDraftFormFingerprint(form: PaidDraftFormValue): string {
  return JSON.stringify(form);
}
