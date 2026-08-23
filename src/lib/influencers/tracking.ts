import { randomBytes } from "node:crypto";

import type {
  InfluencerTrackingLink,
  InfluencerTrackingLinkInput,
} from "@/lib/influencers/types";
import {
  InfluencerValidationError,
  normalizeInfluencerPublicHttpsUrl,
} from "@/lib/influencers/validation";

export const INFLUENCER_TRACKING_TTL_DAYS = 180;

// Common registry-controlled second-level labels beneath country-code TLDs.
// It is not a replacement for a full PSL parser, but it prevents common public
// suffixes from ever becoming the ownership boundary for a Marpin redirect.
const COUNTRY_CODE_REGISTRY_LABELS = new Set([
  "ac",
  "asn",
  "biz",
  "co",
  "com",
  "edu",
  "firm",
  "gen",
  "go",
  "gov",
  "id",
  "ind",
  "lg",
  "mil",
  "ne",
  "net",
  "nom",
  "or",
  "org",
  "plc",
  "res",
  "sch",
  "web",
]);

// Widely used private/public hosting suffixes where accepting the suffix itself
// would let an unrelated tenant create an apparently brand-owned destination.
const SHARED_HOSTING_SUFFIXES = new Set([
  "appspot.com",
  "azurewebsites.net",
  "blogspot.com",
  "cloudfront.net",
  "firebaseapp.com",
  "github.io",
  "herokuapp.com",
  "netlify.app",
  "pages.dev",
  "vercel.app",
  "web.app",
  "workers.dev",
]);

function key(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(normalized)) {
    throw new InfluencerValidationError("invalid_tracking_key", `${label} is invalid`);
  }
  return normalized;
}

function destination(value: string): URL {
  try {
    return new URL(
      normalizeInfluencerPublicHttpsUrl(value, "destinationUrl") as string,
    );
  } catch {
    throw new InfluencerValidationError(
      "invalid_destination",
      "Tracking destination must be a public HTTPS URL",
    );
  }
}

function comparableHostname(value: string): string {
  return value.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

function publicSuffixLabelCount(hostname: string): number {
  const labels = hostname.split(".");
  const tail = labels.slice(-2).join(".");
  if (SHARED_HOSTING_SUFFIXES.has(tail)) return 2;

  const topLevel = labels.at(-1) ?? "";
  const secondLevel = labels.at(-2) ?? "";
  if (
    topLevel.length === 2 &&
    COUNTRY_CODE_REGISTRY_LABELS.has(secondLevel)
  ) {
    return 2;
  }
  return 1;
}

function assertRegistrableBrandHostname(hostname: string): void {
  const labels = hostname.split(".").filter(Boolean);
  const suffixLabels = publicSuffixLabelCount(hostname);
  if (labels.length <= suffixLabels) {
    throw new InfluencerValidationError(
      "invalid_brand_domain",
      "The brand website must use a registrable domain, not a public suffix",
    );
  }
}

export function assertInfluencerTrackingDestination(
  destinationUrl: string,
  brandWebsiteUrl: string | null,
): void {
  if (!brandWebsiteUrl) {
    throw new InfluencerValidationError(
      "brand_website_required",
      "Add the brand website before creating a tracking link",
    );
  }
  const target = destination(destinationUrl);
  const brand = destination(brandWebsiteUrl);
  const targetHost = comparableHostname(target.hostname);
  const brandHost = comparableHostname(brand.hostname);
  assertRegistrableBrandHostname(brandHost);
  if (targetHost !== brandHost && !targetHost.endsWith(`.${brandHost}`)) {
    throw new InfluencerValidationError(
      "destination_not_owned",
      "Tracking links can only point to the brand website or one of its subdomains",
    );
  }
}

export function influencerTrackingExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + INFLUENCER_TRACKING_TTL_DAYS * 24 * 60 * 60 * 1_000);
}

export function createInfluencerTrackingLink(
  input: InfluencerTrackingLinkInput,
  generateSlug: () => string = () => randomBytes(24).toString("base64url"),
): InfluencerTrackingLink {
  const url = destination(input.destinationUrl);
  const campaignKey = key(input.campaignKey, "campaignKey");
  const influencerKey = key(input.influencerKey, "influencerKey");
  const slug = generateSlug();
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(slug)) {
    throw new InfluencerValidationError("invalid_tracking_slug", "Tracking slug is invalid");
  }
  url.searchParams.set("utm_source", input.platform);
  url.searchParams.set("utm_medium", "influencer");
  url.searchParams.set("utm_campaign", campaignKey);
  url.searchParams.set("utm_content", influencerKey);
  return {
    slug,
    destinationUrl: destination(input.destinationUrl).toString(),
    taggedDestinationUrl: url.toString(),
  };
}
