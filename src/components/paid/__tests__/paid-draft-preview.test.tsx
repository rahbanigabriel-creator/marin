import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";

import type { ContentAssetDto } from "@/lib/content/types";
import { PaidDraftAdPreview } from "../PaidDraftAdPreview";
import { PaidDraftEditor } from "../PaidDraftEditor";
import { createPaidDraftAd, createPaidDraftAdGroup, createPaidDraftForm } from "../paid-draft-form";
import { paidPreviewAds, paidPreviewDestination, paidPreviewMediaUrl, paidSearchPreview, selectedPaidPreview } from "../paid-draft-preview";

function fixture(platform: "meta_ads" | "google_ads" = "meta_ads") {
  const value = createPaidDraftForm({ id: "connection_meta", platform, accountId: "123", accountName: "Marpin account", currency: "EUR", timezone: "Europe/Madrid" });
  const ad = value.adGroups[0].ads[0];
  Object.assign(ad, {
    name: "Unsaved launch creative",
    assetId: "asset_image",
    primaryText: "Real copy\nfrom the unsaved form.",
    headline: "Your next launch",
    description: "Bring your campaign together.",
    callToAction: "sign_up",
    destinationUrl: "https://www.marpin.ai/start?source=draft",
    headlines: "Launch with confidence\nPlan the next campaign\nKeep everything together\nFourth variation",
    descriptions: "Your exact first description.\nYour exact second description.\nThird variation.",
    path1: "campaigns",
    path2: "launch",
  });
  const asset: ContentAssetDto = { id: "asset_image", kind: "image", mimeType: "image/png", bytes: 2500, filename: "launch.png", width: 1080, height: 1080, durationMs: null, source: "upload", contentUrl: "/api/assets/asset_image/content", createdAt: "2026-09-05T12:00:00Z" };
  return { value, asset, ad };
}

test("preview selection is stable across reorder and falls back after removal", () => {
  const { value } = fixture();
  const second = createPaidDraftAd();
  value.adGroups[0].ads.push(second);
  const selection = { groupId: value.adGroups[0].localId, adId: second.localId };
  assert.equal(selectedPaidPreview(value, selection)?.ad, second);
  value.adGroups[0].ads.reverse();
  assert.equal(selectedPaidPreview(value, selection)?.ad, second);
  value.adGroups[0].ads.shift();
  assert.equal(selectedPaidPreview(value, selection)?.ad, value.adGroups[0].ads[0]);
  value.adGroups = [];
  assert.equal(selectedPaidPreview(value, selection), null);
});

test("preview selection binds group and ad identity together", () => {
  const { value } = fixture();
  const next = createPaidDraftAdGroup();
  next.ads[0].localId = value.adGroups[0].ads[0].localId;
  next.ads[0].name = "Same local ad id in another group";
  value.adGroups.push(next);
  assert.equal(selectedPaidPreview(value, { groupId: next.localId, adId: next.ads[0].localId })?.ad, next.ads[0]);
  assert.equal(paidPreviewAds(value)[1].groupName, "Ad group 2");
});

test("media URLs keep authenticated asset routes and reject executable or ambiguous URLs", () => {
  assert.equal(paidPreviewMediaUrl("/api/assets/asset_1/content"), "/api/assets/asset_1/content");
  assert.equal(paidPreviewMediaUrl("https://assets.example.com/image.png"), "https://assets.example.com/image.png");
  for (const input of [undefined, "", "javascript:alert(1)", "data:image/svg+xml,test", "//example.com/a", "/\\example.com/a", "https://user:password@example.com/a", "https://example.com/a\n", " https://example.com/a", "http://example.com/a"]) {
    assert.equal(paidPreviewMediaUrl(input), null, String(input));
  }
});

test("destination display never exposes credentials, tracking queries or unsafe schemes", () => {
  assert.deepEqual(paidPreviewDestination("https://www.marpin.ai/start?token=private#something"), { host: "marpin.ai", valid: true });
  assert.equal(paidPreviewDestination("https://user:password@marpin.ai").valid, false);
  assert.equal(paidPreviewDestination("javascript:alert(1)").valid, false);
  assert.equal(paidPreviewDestination("not a url").host, "Invalid destination URL");
  assert.equal(paidPreviewDestination("").host, "Destination URL");
});

test("RSA preview uses actual headline and description options without modifying the form", () => {
  const { ad } = fixture("google_ads");
  const before = structuredClone(ad);
  assert.deepEqual(paidSearchPreview(ad), {
    headlines: ["Launch with confidence", "Plan the next campaign", "Keep everything together"],
    descriptions: ["Your exact first description.", "Your exact second description."],
    path: "campaigns / launch",
  });
  assert.deepEqual(ad, before);
});

test("Meta preview renders actual unsaved asset, copy, CTA and destination with no fabricated metrics", () => {
  const { value, asset } = fixture();
  const before = structuredClone(value);
  const html = renderToStaticMarkup(<PaidDraftAdPreview value={value} assets={[asset]} selection={null} onSelect={() => undefined} unsaved />);
  const root = parse(html);
  assert.equal(root.querySelector("article img")?.getAttribute("src"), asset.contentUrl);
  assert.equal(root.querySelector("article img")?.getAttribute("alt"), "launch.png");
  assert.match(root.textContent, /Real copy\nfrom the unsaved form/);
  assert.match(root.textContent, /Your next launch/);
  assert.match(root.textContent, /Bring your campaign together/);
  assert.match(root.textContent, /Sign up/);
  assert.match(root.textContent, /marpin\.ai/);
  assert.match(root.textContent, /Unsaved draft/);
  assert.match(root.textContent, /Page identity pending/);
  assert.match(root.textContent, /not a delivery guarantee/);
  assert.match(root.textContent, /Marpin account/);
  assert.equal(root.querySelectorAll("article button, article a").length, 0);
  assert.doesNotMatch(root.textContent, /likes|followers|impressions|ROAS|CTR|comments/i);
  assert.deepEqual(value, before);
});

test("a new unsaved asset selection replaces the preview content, not a saved snapshot", () => {
  const { value, asset } = fixture();
  const next = { ...asset, id: "asset_new", filename: "new.png", contentUrl: "/api/assets/asset_new/content" };
  value.adGroups[0].ads[0].assetId = next.id;
  value.adGroups[0].ads[0].primaryText = "Updated unsaved copy";
  const root = parse(renderToStaticMarkup(<PaidDraftAdPreview value={value} assets={[asset, next]} selection={null} onSelect={() => undefined} unsaved />));
  assert.equal(root.querySelector("article img")?.getAttribute("src"), next.contentUrl);
  assert.match(root.textContent, /Updated unsaved copy/);
  assert.doesNotMatch(root.textContent, /Real copy/);
});

test("approved delivery page name takes precedence over the ad account label", () => {
  const { value, asset } = fixture();
  const deliveryValue = { ...value, metaDelivery: { version: 1 as const, pageId: "1234", pageName: "Marpin official page", placement: "facebook_feed" as const, specialAdCategory: "none" as const, beneficiary: "Marpin", payer: "Marpin" } };
  const root = parse(renderToStaticMarkup(<PaidDraftAdPreview value={deliveryValue} assets={[asset]} selection={null} onSelect={() => undefined} unsaved />));
  assert.match(root.querySelector("article")?.textContent ?? "", /Marpin official page/);
  assert.doesNotMatch(root.querySelector("article")?.textContent ?? "", /Marpin account|Account name/);
});

test("video creative has native playback controls without automatic playback", () => {
  const { value, asset } = fixture();
  value.adGroups[0].ads[0].format = "video";
  const root = parse(renderToStaticMarkup(<PaidDraftAdPreview value={value} assets={[{ ...asset, kind: "video", mimeType: "video/mp4", filename: "launch.mp4" }]} selection={null} onSelect={() => undefined} unsaved={false} />));
  const video = root.querySelector("video");
  assert.ok(video);
  assert.equal(video.getAttribute("src"), asset.contentUrl);
  assert.ok(video.hasAttribute("controls"));
  assert.ok(video.hasAttribute("playsInline"));
  assert.equal(video.hasAttribute("autoPlay"), false);
  assert.equal(video.getAttribute("preload"), "metadata");
  assert.match(root.textContent, /Saved draft/);
});

test("missing or unsafe selected assets show an honest empty preview", () => {
  const { value, asset } = fixture();
  for (const assets of [[], [{ ...asset, contentUrl: "javascript:alert(1)" }]]) {
    const root = parse(renderToStaticMarkup(<PaidDraftAdPreview value={value} assets={assets} selection={null} onSelect={() => undefined} unsaved />));
    assert.equal(root.querySelectorAll("article img, article video").length, 0);
    assert.match(root.textContent, /No creative selected|Asset unavailable/);
  }
});

test("Google preview displays a marked example combination and never invents assets", () => {
  const { value, asset } = fixture("google_ads");
  const root = parse(renderToStaticMarkup(<PaidDraftAdPreview value={value} assets={[asset]} selection={null} onSelect={() => undefined} unsaved />));
  assert.match(root.textContent, /Launch with confidence \| Plan the next campaign \| Keep everything together/);
  assert.match(root.textContent, /Your exact first description\. Your exact second description\./);
  assert.match(root.textContent, /Example RSA combination/);
  assert.doesNotMatch(root.textContent, /Fourth variation|Third variation/);
  assert.equal(root.querySelectorAll("article img, article video").length, 0);
});

test("preview selection controls have distinct accessible labels for multiple ads", () => {
  const { value, asset } = fixture();
  const group = createPaidDraftAdGroup();
  group.name = "Second audience";
  group.ads[0].name = "Second ad";
  value.adGroups.push(group);
  const root = parse(renderToStaticMarkup(<PaidDraftAdPreview value={value} assets={[asset]} selection={{ groupId: group.localId, adId: group.ads[0].localId }} onSelect={() => undefined} unsaved />));
  assert.equal(root.querySelector('[aria-label="Preview Second audience: Second ad"]')?.getAttribute("aria-pressed"), "true");
  assert.ok(root.querySelector('[aria-label="Facebook feed preview"]'));
  assert.ok(root.querySelector('[aria-label="Instagram feed preview"]'));
  assert.ok(root.querySelector('[aria-label="Mobile ad preview"]'));
  assert.ok(root.querySelector('[aria-label="Desktop ad preview"]'));
});

test("visual editor preserves all original editing controls and validation while showing a draft preview", () => {
  const { value, asset } = fixture();
  const root = parse(renderToStaticMarkup(<PaidDraftEditor value={value} connections={[value.connection]} assets={[asset]} issues={[{ path: "campaign.name", message: "Campaign name is required" }]} isNew disabled={false} saving={false} uploading={false} dirty onChange={() => undefined} onConnectionChange={() => undefined} onTemplateChange={() => undefined} onSave={() => undefined} onReady={() => undefined} canMarkReady={false} onUpload={() => undefined} deliverySettings={<div data-testid="delivery-settings">Meta delivery settings</div>} />));
  for (const name of ["Connected paid account", "Campaign type", "Campaign name", "Budget", "Currency", "Budget cadence", "Timezone", "Start date", "Start time", "End date", "End time", "Assumptions", "Ad group 1 name", "Ad group 1 locations", "Ad group 1 languages", "Ad group 1 minimum age", "Ad group 1 maximum age", "Ad group 1 interests", "Ad group 1 ad 1 name", "Ad group 1 ad 1 creative asset", "Upload creative asset", "Ad group 1 ad 1 primary text", "Ad group 1 ad 1 headline", "Ad group 1 ad 1 description", "Ad group 1 ad 1 call to action", "Ad group 1 ad 1 destination URL"]) {
    const control = root.querySelector(`[aria-label="${name}"]`);
    assert.ok(control, name);
    assert.equal(control.hasAttribute("disabled"), false, name);
  }
  assert.match(root.querySelector('[role="alert"]')?.textContent ?? "", /Campaign name is required/);
  assert.match(root.querySelector('button[type="submit"]')?.textContent ?? "", /Create draft/);
  assert.ok(root.querySelector('[aria-label="Live draft ad preview"]'));
  assert.ok(root.querySelector('[aria-label="Campaign editor sections"]'));
  assert.ok(root.querySelector('[aria-labelledby="paid-draft-setup-title"] [data-testid="delivery-settings"]'));
});
