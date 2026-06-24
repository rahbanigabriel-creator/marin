import "server-only";
import type { ExecMode } from "@/types/artifacts";

/**
 * The Action-OS capability table — the single source of truth for what an action
 * can REALLY do. The agent proposes intent (platform + kind); the SERVER decides
 * the exec mode, the approval requirement, and the honest button label here —
 * never the model. Default is the always-works "prepare + open prefilled" spine;
 * only genuinely API-postable actions are "api", and even those degrade to
 * "guided" at runtime when the write scope / connection isn't live (the executor
 * enforces that). This is what keeps a button from ever lying.
 */
export interface Capability {
  execMode: ExecMode;
  requiresApproval: boolean;
  ctaLabel: string;
  /** OAuth write scopes this action needs (for the lazy read→write upgrade). */
  writeScopes?: string[];
}

export function classify(platform: string | undefined, kind: string): Capability {
  const k = (kind || "").toLowerCase();
  const p = (platform || "").toLowerCase();

  // Off-platform work (SEO, website, email copy): prepare + copy, no OAuth ever.
  if (!platform || p === "none" || k === "seo_meta" || k === "manual" || k.startsWith("seo") || k === "email") {
    return { execMode: "prepare", requiresApproval: false, ctaLabel: "Copy brief" };
  }

  // X / Twitter post — the one real single-POST write in Phase 1 (needs tweet.write).
  if (p === "x_ads" && (k === "tweet" || k === "post")) {
    return { execMode: "api", requiresApproval: true, ctaLabel: "Post to X", writeScopes: ["tweet.write"] };
  }

  // Paid ad creation — always prepare + open the campaign builder (money-gated,
  // heavy, per-platform app review). The click is still the approval; no money moves.
  if (k === "ad_draft" || k.includes("ad")) {
    return { execMode: "guided", requiresApproval: true, ctaLabel: openLabel(p) };
  }

  // Public posting on the other socials — prepare + deep-link until each platform's
  // Content/Community API app review lands (then this row promotes to "api").
  if (k === "post" || k === "page" || k === "pin" || k === "video") {
    return { execMode: "guided", requiresApproval: true, ctaLabel: openLabel(p) };
  }

  return { execMode: "guided", requiresApproval: true, ctaLabel: openLabel(p) };
}

function openLabel(platform: string): string {
  const name: Record<string, string> = {
    meta_ads: "Meta",
    tiktok_ads: "TikTok",
    linkedin_ads: "LinkedIn",
    google_ads: "Google Ads",
    microsoft_ads: "Microsoft Ads",
    pinterest_ads: "Pinterest",
    snapchat_ads: "Snapchat",
    reddit_ads: "Reddit",
    x_ads: "X",
    amazon_ads: "Amazon Ads",
    apple_search_ads: "Apple Search Ads",
  };
  return `Open in ${name[platform] ?? "the platform"} ▸`;
}
