import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPaidDraftAssetSuitability,
  paidDraftAssetIds,
} from "../assets";
import { PaidDraftValidationError, parsePaidCampaignSnapshotV1 } from "../validation";

function socialSnapshot(input: {
  platform: "meta_ads" | "tiktok_ads";
  format: "image" | "video";
  assetId?: string;
}) {
  const template = input.platform === "meta_ads" ? "meta_traffic" : "tiktok_traffic";
  return parsePaidCampaignSnapshotV1({
    schemaVersion: 1,
    source: "manual",
    platform: input.platform,
    template,
    connection: {
      platform: input.platform,
      connectionId: "connection_1",
      accountId: "account_1",
      accountName: "Account",
    },
    campaign: { name: "Launch", objective: "traffic" },
    budget: { amountMinor: 2_000, currency: "EUR", cadence: "daily" },
    schedule: {
      startsAt: "2026-09-01T09:00:00+02:00",
      endsAt: "2026-09-30T18:00:00+02:00",
      timezone: "Europe/Madrid",
    },
    adGroups: [{
      localId: "group_1",
      name: "Founders",
      targeting: {
        kind: "audience",
        locations: ["ES"],
        languages: ["en"],
        ageMin: 18,
        ageMax: 65,
        genders: ["all"],
        interests: [],
      },
      ads: [{
        localId: "ad_1",
        name: "Creative",
        format: input.format,
        assetIds: [input.assetId ?? "asset_1"],
        primaryText: "Ship distribution with the product.",
        headline: "Plan the launch",
        ...(input.platform === "meta_ads" ? { description: null } : {}),
        callToAction: "learn_more",
        destinationUrl: "https://www.marpin.ai/",
      }],
    }],
    assumptions: [],
  });
}

function expectAssetError(
  action: () => void,
  code: string,
  path = "adGroups[0].ads[0].assetIds[0]",
): void {
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof PaidDraftValidationError &&
      error.code === code &&
      error.path === path,
  );
}

test("Meta creative assets require the exact format kind and supported MIME", () => {
  const image = socialSnapshot({ platform: "meta_ads", format: "image" });
  assert.doesNotThrow(() =>
    assertPaidDraftAssetSuitability(image, [
      { id: "asset_1", kind: "image", mimeType: "image/png" },
    ]),
  );
  assert.doesNotThrow(() =>
    assertPaidDraftAssetSuitability(image, [
      { id: "asset_1", kind: "image", mimeType: "image/jpg" },
    ]),
  );
  expectAssetError(
    () => assertPaidDraftAssetSuitability(image, []),
    "asset_not_found",
  );
  expectAssetError(
    () =>
      assertPaidDraftAssetSuitability(image, [
        { id: "asset_1", kind: "video", mimeType: "video/mp4" },
      ]),
    "asset_type_mismatch",
  );
  expectAssetError(
    () =>
      assertPaidDraftAssetSuitability(image, [
        { id: "asset_1", kind: "image", mimeType: "image/webp" },
      ]),
    "asset_mime_mismatch",
  );

  const video = socialSnapshot({ platform: "meta_ads", format: "video" });
  assert.doesNotThrow(() =>
    assertPaidDraftAssetSuitability(video, [
      { id: "asset_1", kind: "video", mimeType: "video/quicktime" },
    ]),
  );
});

test("TikTok creatives require a provider-suitable video", () => {
  const snapshot = socialSnapshot({
    platform: "tiktok_ads",
    format: "video",
    assetId: "video_1",
  });
  assert.deepEqual(paidDraftAssetIds(snapshot), ["video_1"]);
  assert.doesNotThrow(() =>
    assertPaidDraftAssetSuitability(snapshot, [
      { id: "video_1", kind: "video", mimeType: "video/mp4" },
    ]),
  );
  expectAssetError(
    () =>
      assertPaidDraftAssetSuitability(snapshot, [
        { id: "video_1", kind: "image", mimeType: "image/png" },
      ]),
    "asset_type_mismatch",
  );
  expectAssetError(
    () =>
      assertPaidDraftAssetSuitability(snapshot, [
        { id: "video_1", kind: "video", mimeType: "video/webm" },
      ]),
    "asset_mime_mismatch",
  );
});
