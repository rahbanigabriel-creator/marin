import assert from "node:assert/strict";
import test from "node:test";

import type { ContentAssetDto } from "@/lib/content/types";

import {
  assetOptionsForPlatform,
  buildPaidCampaignSnapshot,
  createPaidDraftForm,
  formFromPaidDraft,
  majorToMinor,
  validatePaidDraftForm,
  type PaidConnectionOption,
} from "../paid-draft-form";

const NOW = new Date("2026-08-21T12:00:00.000Z");

function account(platform: PaidConnectionOption["platform"]): PaidConnectionOption {
  return {
    id: `connection_${platform}`,
    platform,
    accountId: `account_${platform}`,
    accountName: `${platform} founder account`,
    currency: "EUR",
    timezone: "Europe/Madrid",
  };
}

function validGoogleForm() {
  const form = createPaidDraftForm(account("google_ads"), "google_search_rsa", NOW);
  form.campaignName = "Founder search launch";
  form.budgetMajor = "42.50";
  form.assumptions = "Landing page is approved\nConversion tracking is verified";
  form.adGroups[0].name = "Distribution software";
  form.adGroups[0].locations = "Spain\nFrance";
  form.adGroups[0].keywords = "exact: marketing operating system\nphrase: distribution for founders";
  form.adGroups[0].negativeKeywords = "free course";
  form.adGroups[0].ads[0].name = "Founder RSA";
  form.adGroups[0].ads[0].headlines = "Ship distribution faster\nYour marketing command center\nPlan every growth channel";
  form.adGroups[0].ads[0].descriptions = "Audit, plan and review distribution in one workspace.\nBuild a launch plan without losing context.";
  form.adGroups[0].ads[0].destinationUrl = "https://www.marpin.ai/paid";
  return form;
}

test("manual Google Search form creates the exact RSA snapshot contract", () => {
  const snapshot = buildPaidCampaignSnapshot(validGoogleForm());
  assert.equal(snapshot.platform, "google_ads");
  assert.equal(snapshot.source, "manual");
  assert.equal(snapshot.campaign.objective, "traffic");
  assert.equal(snapshot.budget.amountMinor, 4250);
  assert.equal(snapshot.schedule.timezone, "Europe/Madrid");
  assert.equal(snapshot.schedule.startsAt.endsWith("+02:00"), true);
  assert.deepEqual(snapshot.assumptions, [
    "Landing page is approved",
    "Conversion tracking is verified",
  ]);
  assert.equal(snapshot.adGroups[0].targeting.keywords[0].matchType, "exact");
  assert.equal(snapshot.adGroups[0].ads[0].headlines.length, 3);
  assert.deepEqual(snapshot.adGroups[0].ads[0].assetIds, []);
});

test("Meta and TikTok forms preserve their supported template and creative contracts", () => {
  const meta = createPaidDraftForm(account("meta_ads"), "meta_lead", NOW);
  meta.campaignName = "Founder lead launch";
  meta.budgetMajor = "75";
  meta.adGroups[0].name = "Technical founders";
  meta.adGroups[0].locations = "Spain";
  meta.adGroups[0].interests = "Software development\nEntrepreneurship";
  meta.adGroups[0].ads[0] = {
    ...meta.adGroups[0].ads[0],
    name: "Founder demo image",
    assetId: "asset_meta_image",
    format: "image",
    primaryText: "Distribution should feel as tractable as shipping code.",
    headline: "Meet your marketing operating system",
    description: "Audit, plan and execute.",
    callToAction: "sign_up",
    destinationUrl: "https://www.marpin.ai/sign-up",
  };
  const metaSnapshot = buildPaidCampaignSnapshot(meta);
  assert.equal(metaSnapshot.platform, "meta_ads");
  assert.equal(metaSnapshot.template, "meta_lead");
  assert.equal(metaSnapshot.campaign.objective, "leads");
  assert.equal(metaSnapshot.adGroups[0].ads[0].assetIds[0], "asset_meta_image");

  const tiktok = createPaidDraftForm(account("tiktok_ads"), "tiktok_conversion", NOW);
  tiktok.campaignName = "Founder TikTok conversion";
  tiktok.budgetMajor = "100";
  tiktok.adGroups[0].name = "Solo founders";
  tiktok.adGroups[0].locations = "United States";
  tiktok.adGroups[0].ads[0] = {
    ...tiktok.adGroups[0].ads[0],
    name: "Founder workflow video",
    assetId: "asset_tiktok_video",
    format: "video",
    primaryText: "Watch a full week of distribution get planned.",
    headline: "Build your distribution system",
    callToAction: "learn_more",
    destinationUrl: "https://www.marpin.ai/demo",
  };
  const tiktokSnapshot = buildPaidCampaignSnapshot(tiktok);
  assert.equal(tiktokSnapshot.platform, "tiktok_ads");
  assert.equal(tiktokSnapshot.template, "tiktok_conversion");
  assert.equal(tiktokSnapshot.campaign.objective, "conversions");
  assert.equal(tiktokSnapshot.adGroups[0].ads[0].format, "video");
});

test("validation reports all visible required fields before the strict backend parser", () => {
  const form = createPaidDraftForm(account("google_ads"), "google_search_rsa", NOW);
  form.adGroups[0].languages = "";
  const result = validatePaidDraftForm(form);
  assert.equal(result.snapshot, null);
  assert.deepEqual(
    result.issues.map((issue) => issue.path),
    [
      "campaign.name",
      "budget.amountMinor",
      "adGroups[0].name",
      "adGroups[0].targeting.locations",
      "adGroups[0].targeting.languages",
      "adGroups[0].targeting.keywords",
      "adGroups[0].ads[0].name",
      "adGroups[0].ads[0].destinationUrl",
      "adGroups[0].ads[0].headlines",
      "adGroups[0].ads[0].descriptions",
    ],
  );
});

test("saved snapshots round-trip into an editable form without losing approval fields", () => {
  const snapshot = buildPaidCampaignSnapshot(validGoogleForm());
  const restored = formFromPaidDraft(snapshot);
  const rebuilt = buildPaidCampaignSnapshot(restored);
  assert.deepEqual(rebuilt, snapshot);
});

test("money conversion is decimal-safe and TikTok exposes only video assets", () => {
  assert.equal(majorToMinor("0.01", "EUR"), 1);
  assert.equal(majorToMinor("999.90", "USD"), 99990);
  assert.equal(majorToMinor("500", "JPY"), 500);
  assert.equal(majorToMinor("1.234", "KWD"), 1234);
  assert.throws(() => majorToMinor("1.001", "EUR"), /2 decimals/);
  const assets: ContentAssetDto[] = [
    { id: "image", kind: "image", mimeType: "image/png", bytes: 1, filename: "image.png", width: 1, height: 1, durationMs: null, source: "upload", contentUrl: "/image", createdAt: NOW.toISOString() },
    { id: "video", kind: "video", mimeType: "video/mp4", bytes: 1, filename: "video.mp4", width: 1, height: 1, durationMs: 1000, source: "upload", contentUrl: "/video", createdAt: NOW.toISOString() },
  ];
  assert.deepEqual(assetOptionsForPlatform(assets, "tiktok_ads").map((asset) => asset.id), ["video"]);
  assert.deepEqual(assetOptionsForPlatform(assets, "meta_ads").map((asset) => asset.id), ["image", "video"]);
});
