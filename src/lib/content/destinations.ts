import type { ProductPlatformId } from "@/lib/product/platforms";

export type OrganicPlatformId = Extract<
  ProductPlatformId,
  "youtube" | "instagram" | "facebook" | "tiktok" | "snapchat" | "reddit" | "pinterest"
>;

/** One launch contract for manual creation, AI generation, and planner controls. */
export const ORGANIC_FORMATS_BY_PLATFORM = {
  youtube: ["video", "short"],
  instagram: ["post", "reel", "story"],
  facebook: ["post", "reel", "story"],
  tiktok: ["video"],
  snapchat: ["story"],
  reddit: ["post"],
  pinterest: ["pin"],
} as const satisfies Record<OrganicPlatformId, readonly string[]>;

export function isOrganicPlatform(platform: string): platform is OrganicPlatformId {
  return Object.hasOwn(ORGANIC_FORMATS_BY_PLATFORM, platform);
}

export function isOrganicDestination(platform: string, format: string): boolean {
  return (
    isOrganicPlatform(platform) &&
    (ORGANIC_FORMATS_BY_PLATFORM[platform] as readonly string[]).includes(format)
  );
}
