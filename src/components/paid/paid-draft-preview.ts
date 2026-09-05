import type { PaidDraftAdForm, PaidDraftFormValue } from "./paid-draft-form";

export interface PaidPreviewSelection {
  groupId: string;
  adId: string;
}

export function paidPreviewAds(value: PaidDraftFormValue) {
  return value.adGroups.flatMap((group, groupIndex) => group.ads.map((ad, adIndex) => ({
    groupId: group.localId,
    adId: ad.localId,
    groupName: group.name.trim() || `Ad group ${groupIndex + 1}`,
    adName: ad.name.trim() || `Ad ${adIndex + 1}`,
    ad,
  })));
}

export function selectedPaidPreview(value: PaidDraftFormValue, selection: PaidPreviewSelection | null) {
  const ads = paidPreviewAds(value);
  return ads.find((item) => item.groupId === selection?.groupId && item.adId === selection.adId) ?? ads[0] ?? null;
}

export function paidPreviewMediaUrl(value: string | undefined): string | null {
  if (!value || value !== value.trim() || /[\u0000-\u0020\\]/.test(value)) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function paidPreviewDestination(value: string): { host: string; valid: boolean } {
  if (!value.trim()) return { host: "Destination URL", valid: false };
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid destination");
    return { host: url.hostname.replace(/^www\./, ""), valid: true };
  } catch {
    return { host: "Invalid destination URL", valid: false };
  }
}

export function paidSearchPreview(ad: PaidDraftAdForm) {
  const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    headlines: lines(ad.headlines).slice(0, 3),
    descriptions: lines(ad.descriptions).slice(0, 2),
    path: [ad.path1.trim(), ad.path2.trim()].filter(Boolean).join(" / "),
  };
}
