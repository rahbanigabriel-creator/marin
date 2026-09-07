import type { PaidAd, PaidCampaign } from "./format";

export function paidMediaUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    if (value.startsWith("/")) {
      const origin = "https://paid-media.invalid";
      return !value.startsWith("//") && !value.includes("\\") && new URL(value, origin).origin === origin ? value : null;
    }
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
}

export function selectPaidCreative(ads: PaidAd[], adId?: string | null): PaidAd | undefined {
  return ads.find((ad) => ad.externalId === adId)
    ?? ads.find((ad) => paidMediaUrl(ad.thumbnailUrl))
    ?? ads[0];
}

function providerId(value: string | null | undefined): string | null {
  return value && /^\d{1,32}$/.test(value) && /[1-9]/.test(value) ? value : null;
}

export function paidProviderHandoff(campaign: PaidCampaign, ad?: PaidAd): {
  href: string;
  label: string;
  detail: string;
} | null {
  const campaignId = providerId(campaign.externalId);
  const adId = ad && campaign.ads.some((item) => item.externalId === ad.externalId)
    ? providerId(ad.externalId) : null;
  if (campaign.platform === "meta_ads") {
    const accountId = providerId(campaign.accountId?.replace(/^act_/, ""));
    if (!accountId || !campaignId) return null;
    const url = new URL(`https://adsmanager.facebook.com/adsmanager/manage/${adId ? "ads" : "campaigns"}`);
    url.searchParams.set("act", accountId);
    url.searchParams.set("selected_campaign_ids", campaignId);
    if (adId) url.searchParams.set("selected_ad_ids", adId);
    return {
      href: url.toString(),
      label: "Edit in Meta Ads Manager",
      detail: "Opens Meta in a new tab. Changes are made there, subject to your Meta permissions.",
    };
  }
  if (campaign.platform === "google_ads") {
    const accountId = campaign.accountId;
    if (!accountId || !/^(?:\d{10}|\d{3}-\d{3}-\d{4})$/.test(accountId)
      || !providerId(accountId.replace(/-/g, "")) || !campaignId) return null;
    // Google Ads' browser account selector is not the API customer ID (ocid).
    return {
      href: "https://ads.google.com/aw/overview",
      label: "Edit in Google Ads",
      detail: `Opens Google Ads in a new tab. Select account ${accountId}, campaign ${campaignId}${adId ? `, ad ${adId}` : ""}. Changes are made there, subject to your Google Ads permissions.`,
    };
  }
  return null;
}
