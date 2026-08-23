import type { ConnectorPlatform } from "@/lib/connectors/types";

/** The two operating modes Marpin is launching with. */
export type ProductMode = "organic" | "paid";

/**
 * Product-facing platform ids. Organic destinations deliberately do not reuse
 * paid-ad connector ids: an Instagram post and a Meta Ads campaign are different
 * objects with different permissions, review requirements, and execution paths.
 */
export type ProductPlatformId =
  | "youtube"
  | "instagram"
  | "facebook"
  | "tiktok"
  | "snapchat"
  | "reddit"
  | "pinterest"
  | "google_ads"
  | "meta_ads"
  | "tiktok_ads"
  | "ga4"
  | "search_console";

export type ConnectionSection = "organic" | "paid" | "measurement";
export type CapabilityLevel = "available" | "assisted" | "planned";

export interface ProductCapabilities {
  /** Connect/read data from the provider. */
  connect: CapabilityLevel;
  /** Create or edit a persisted draft inside Marpin. */
  draft: CapabilityLevel;
  /** Queue a draft for a future time. */
  schedule: CapabilityLevel;
  /** Publish or launch through a provider API. */
  execute: CapabilityLevel;
}

export interface ProductPlatform {
  id: ProductPlatformId;
  label: string;
  section: ConnectionSection;
  mode?: ProductMode;
  description: string;
  /** OAuth/data adapter used today, when one exists. */
  connectorPlatform?: ConnectorPlatform;
  capabilities: ProductCapabilities;
}

const organic = (
  id: Extract<
    ProductPlatformId,
    "youtube" | "instagram" | "facebook" | "tiktok" | "snapchat" | "reddit" | "pinterest"
  >,
  label: string,
  description: string,
): ProductPlatform => ({
  id,
  label,
  section: "organic",
  mode: "organic",
  description,
  capabilities: {
    connect: "planned",
    draft: "available",
    schedule: "available",
    execute: "assisted",
  },
});

const paid = (
  id: Extract<ProductPlatformId, "google_ads" | "meta_ads" | "tiktok_ads">,
  label: string,
  description: string,
): ProductPlatform => ({
  id,
  label,
  section: "paid",
  mode: "paid",
  description,
  connectorPlatform: id,
  capabilities: {
    connect: "available",
    draft: "available",
    schedule: "planned",
    execute: "planned",
  },
});

/**
 * The launch catalog is the product contract. Dormant adapters may exist in the
 * connector registry, but nothing user-facing should derive scope from that
 * implementation registry.
 */
export const PRODUCT_PLATFORMS = [
  paid("google_ads", "Google Ads", "Campaign reporting and reviewable campaign drafts."),
  paid("meta_ads", "Meta Ads", "Facebook and Instagram ad reporting and campaign drafts."),
  paid("tiktok_ads", "TikTok Ads", "TikTok campaign reporting and campaign drafts."),
  organic("youtube", "YouTube", "Videos, Shorts, titles, descriptions, and publishing plans."),
  organic("instagram", "Instagram", "Feed posts, Reels, Stories, and carousel plans."),
  organic("facebook", "Facebook", "Page posts, video, and community content."),
  organic("tiktok", "TikTok", "Organic videos, captions, and weekly publishing plans."),
  organic("snapchat", "Snapchat", "Spotlight and story content plans."),
  organic("reddit", "Reddit", "Community-aware posts and discussion plans."),
  organic("pinterest", "Pinterest", "Pins, boards, descriptions, and publishing plans."),
  {
    id: "ga4",
    label: "Google Analytics 4",
    section: "measurement",
    mode: "organic",
    description: "Website traffic, engagement, and conversion evidence.",
    connectorPlatform: "ga4",
    capabilities: { connect: "available", draft: "planned", schedule: "planned", execute: "planned" },
  },
  {
    id: "search_console",
    label: "Google Search Console",
    section: "measurement",
    mode: "organic",
    description: "Search queries, pages, rankings, and technical search evidence.",
    connectorPlatform: "search_console",
    capabilities: { connect: "available", draft: "planned", schedule: "planned", execute: "planned" },
  },
] as const satisfies readonly ProductPlatform[];

export const PRODUCT_PLATFORM_BY_ID = Object.fromEntries(
  PRODUCT_PLATFORMS.map((platform) => [platform.id, platform]),
) as Record<ProductPlatformId, ProductPlatform>;

/** Only these existing OAuth/data connectors are part of the launch product. */
export const LAUNCH_CONNECTOR_PLATFORMS = PRODUCT_PLATFORMS.flatMap((platform) =>
  platform.connectorPlatform ? [platform.connectorPlatform] : [],
) as ConnectorPlatform[];

export const PAID_PLATFORM_IDS = ["google_ads", "meta_ads", "tiktok_ads"] as const;
export const ORGANIC_PLATFORM_IDS = [
  "youtube",
  "instagram",
  "facebook",
  "tiktok",
  "snapchat",
  "reddit",
  "pinterest",
] as const;

export function isLaunchConnectorPlatform(platform: string): platform is ConnectorPlatform {
  return LAUNCH_CONNECTOR_PLATFORMS.includes(platform as ConnectorPlatform);
}
