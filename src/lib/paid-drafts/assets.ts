import type { PaidCampaignSnapshotV1 } from "./types";
import { PaidDraftValidationError } from "./validation";

type PaidAssetKind = "image" | "video";

const META_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const META_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime"]);
const TIKTOK_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime"]);

export interface PaidDraftAssetRecord {
  id: string;
  kind: string;
  mimeType: string;
}

interface PaidDraftAssetRequirement {
  id: string;
  kind: PaidAssetKind;
  mimeTypes: ReadonlySet<string>;
  path: string;
}

function normalizedMimeType(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

function assetRequirements(
  snapshot: PaidCampaignSnapshotV1,
): PaidDraftAssetRequirement[] {
  if (snapshot.platform === "google_ads") return [];

  const requirements: PaidDraftAssetRequirement[] = [];
  snapshot.adGroups.forEach((group, groupIndex) => {
    group.ads.forEach((ad, adIndex) => {
      const id = ad.assetIds[0];
      const path = `adGroups[${groupIndex}].ads[${adIndex}].assetIds[0]`;
      if (snapshot.platform === "tiktok_ads") {
        requirements.push({
          id,
          kind: "video",
          mimeTypes: TIKTOK_VIDEO_MIME_TYPES,
          path,
        });
        return;
      }
      requirements.push({
        id,
        kind: ad.format,
        mimeTypes:
          ad.format === "image" ? META_IMAGE_MIME_TYPES : META_VIDEO_MIME_TYPES,
        path,
      });
    });
  });
  return requirements;
}

export function paidDraftAssetIds(snapshot: PaidCampaignSnapshotV1): string[] {
  return [...new Set(assetRequirements(snapshot).map((item) => item.id))];
}

export function assertPaidDraftAssetSuitability(
  snapshot: PaidCampaignSnapshotV1,
  records: readonly PaidDraftAssetRecord[],
): void {
  const byId = new Map(records.map((record) => [record.id, record]));
  for (const requirement of assetRequirements(snapshot)) {
    const asset = byId.get(requirement.id);
    if (!asset) {
      throw new PaidDraftValidationError(
        "asset_not_found",
        "Every creative asset must belong to this workspace",
        requirement.path,
      );
    }
    if (asset.kind !== requirement.kind) {
      throw new PaidDraftValidationError(
        "asset_type_mismatch",
        `This creative requires a ${requirement.kind} asset`,
        requirement.path,
      );
    }
    if (!requirement.mimeTypes.has(normalizedMimeType(asset.mimeType))) {
      throw new PaidDraftValidationError(
        "asset_mime_mismatch",
        `This ${requirement.kind} file type is not supported for the selected ad format`,
        requirement.path,
      );
    }
  }
}
