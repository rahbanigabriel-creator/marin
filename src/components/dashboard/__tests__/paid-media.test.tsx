import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PaidCreativeGallery } from "../PaidCreativeGallery";
import { PaidCreativeInspection } from "../PaidCreativeInspection";
import { PaidCreativeMedia } from "../PaidCreativeMedia";
import { DrillDownPanel } from "../DrillDownPanel";
import { paidMediaUrl, paidProviderHandoff, selectPaidCreative } from "../paid-media";
import type { MetricRecord, PaidAd, PaidCampaign } from "../format";

const metrics: MetricRecord = {
  spend: 120, revenue: 240, roas: 2, cpa: 12, conversions: 10, clicks: 100,
  impressions: 2000, ctr: 5, cpc: 1.2, cpm: 60, cvr: 10, aov: 24,
};
function creative(externalId: string, thumbnailUrl: string | null): PaidAd {
  return {
    ...metrics, externalId, name: `Ad ${externalId}`, status: "active", creativeType: "image",
    thumbnailUrl, title: "Headline", body: "Full creative copy", callToAction: "Learn more",
    linkUrl: "https://example.test/product", currency: "EUR", timezone: "Europe/Madrid",
    metricsFrom: "2026-09-01", metricsTo: "2026-09-02",
  };
}
function campaign(): PaidCampaign {
  return {
    ...metrics, identity: "meta_ads:123:456", accountKey: "meta_ads:123", accountId: "act_123",
    accountName: "Test account", externalId: "456", platform: "meta_ads", label: "Meta Ads",
    campaign: "Test campaign", currency: "EUR", timezone: "Europe/Madrid", currencyUnsafe: false,
    sourceState: "available", observedFrom: "2026-09-01", observedTo: "2026-09-02",
    status: "active", objective: "Sales", budget: 40, budgetType: "daily", series: [],
    ads: [creative("789", null), creative("790", "https://example.test/image.jpg")],
  };
}

test("creative selection honors initial IDs, falls back after removal, and supports empty snapshots", () => {
  const { ads } = campaign();
  assert.equal(selectPaidCreative(ads, "789"), ads[0]);
  assert.equal(selectPaidCreative(ads, "790"), ads[1]);
  assert.equal(selectPaidCreative(ads), ads[1]);
  assert.equal(selectPaidCreative(ads, "removed"), ads[1]);
  assert.equal(selectPaidCreative([ads[0]], "removed"), ads[0]);
  assert.equal(selectPaidCreative([]), undefined);
  assert.equal(selectPaidCreative([creative("1", "javascript:alert(1)"), ads[1]]), ads[1]);
});

test("media URLs retain signed provider URLs without inventing larger assets", () => {
  const signed = "https://example.test/image.jpg?stp=s64x64&signature=a%2Bb&expires=123";
  assert.equal(paidMediaUrl(signed), signed);
  for (const invalid of [null, "", " ", "//example.test/image.jpg", "javascript:alert(1)", "data:image/png;base64,test", "https://user:pass@example.test/image.jpg"]) {
    assert.equal(paidMediaUrl(invalid), null);
  }
});

test("media accepts root-relative first-party assets without protocol-relative URL escapes", () => {
  for (const path of ["/marpin-logo.png", "/media/creative image.jpg?version=2", "/image.jpg"]) {
    assert.equal(paidMediaUrl(path), path);
  }
  for (const invalid of ["//example.test/image.jpg", "///example.test/image.jpg", "/\\example.test/image.jpg", "/\n/example.test/image.jpg", "/\t/example.test/image.jpg"]) {
    assert.equal(paidMediaUrl(invalid), null);
  }
  const html = renderToStaticMarkup(<PaidCreativeMedia src="/marpin-logo.png" alt="Marpin" />);
  assert.match(html, /src="\/marpin-logo.png"/);
  assert.doesNotMatch(html, /Preview unavailable/);
});

test("Meta handoff scopes validated account, campaign and selected ad IDs", () => {
  const value = campaign();
  const result = paidProviderHandoff(value, value.ads[1]);
  assert.equal(result?.label, "Edit in Meta Ads Manager");
  const url = new URL(result!.href);
  assert.equal(url.origin, "https://adsmanager.facebook.com");
  assert.equal(url.pathname, "/adsmanager/manage/ads");
  assert.deepEqual(Object.fromEntries(url.searchParams), { act: "123", selected_campaign_ids: "456", selected_ad_ids: "790" });
  assert.match(result!.detail, /Changes are made there/);
  const campaignUrl = new URL(paidProviderHandoff(value)!.href);
  assert.equal(campaignUrl.pathname, "/adsmanager/manage/campaigns");
  assert.equal(campaignUrl.searchParams.has("selected_ad_ids"), false);
});

test("provider handoff rejects malformed IDs and never selects another campaign's ad", () => {
  const value = campaign();
  for (const invalid of [null, "", "0", "1&redirect=evil", "https://example.test", "123/456", " 123", "9".repeat(33)]) {
    assert.equal(paidProviderHandoff({ ...value, accountId: invalid }), null);
    assert.equal(paidProviderHandoff({ ...value, externalId: invalid }), null);
  }
  const url = new URL(paidProviderHandoff(value, creative("999", null))!.href);
  assert.equal(url.searchParams.has("selected_ad_ids"), false);
  const malformedAd = creative("789&redirect=evil", null);
  assert.equal(new URL(paidProviderHandoff({ ...value, ads: [malformedAd] }, malformedAd)!.href).searchParams.has("selected_ad_ids"), false);
  assert.equal(paidProviderHandoff({ ...value, platform: "tiktok_ads" }), null);
});

test("Google handoff is explicitly provider-side without a fabricated ocid deep link", () => {
  for (const accountId of ["1234567890", "123-456-7890"]) {
    const value = { ...campaign(), platform: "google_ads", accountId };
    const result = paidProviderHandoff(value, value.ads[1]);
    assert.equal(result?.href, "https://ads.google.com/aw/overview");
    assert.equal(result?.label, "Edit in Google Ads");
    assert.match(result!.detail, /campaign 456, ad 790/);
    assert.ok(result!.detail.includes(accountId));
  }
  for (const accountId of ["123", "0000000000", "-1234567890", "123--456-7890", "1234567890&ocid=1"]) {
    assert.equal(paidProviderHandoff({ ...campaign(), platform: "google_ads", accountId }), null);
  }
});

test("media renders at most native size and labels absent or unusable previews honestly", () => {
  const html = renderToStaticMarkup(<PaidCreativeMedia src="https://example.test/image.jpg" alt="Creative" inspection />);
  assert.match(html, /object-scale-down/);
  assert.doesNotMatch(html, /object-cover|blur|scale-\[|<video/);
  assert.match(html, /loading="eager"/);
  assert.match(html, /referrerPolicy="no-referrer"/);
  assert.match(renderToStaticMarkup(<PaidCreativeMedia src={null} alt="Creative" />), /No preview supplied/);
  const invalid = renderToStaticMarkup(<PaidCreativeMedia src="javascript:alert(1)" alt="Creative" inspection />);
  assert.match(invalid, /Preview unavailable/);
  assert.doesNotMatch(invalid, /<img|javascript:/);
});

test("inspection exposes the selected creative, full copy, poster limitations and provider handoff", () => {
  const value = campaign();
  const ad = { ...value.ads[1], creativeType: "video" };
  const html = renderToStaticMarkup(<PaidCreativeInspection campaign={value} ad={ad} onSelect={() => {}} />);
  assert.match(html, /value="790" selected=""/);
  assert.match(html, /Full creative copy/);
  assert.match(html, /Video poster only\. Playback is not supplied/);
  assert.match(html, /Edit in Meta Ads Manager/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /aria-label="Previous creative"/);
  assert.match(html, /aria-label="Next creative"[^>]*disabled=""/);
  assert.doesNotMatch(html, /<video|Save changes|Publish campaign/);
});

test("empty creative snapshots retain campaign handoff and unavailable link states are explicit", () => {
  const value = { ...campaign(), ads: [] };
  const html = renderToStaticMarkup(<PaidCreativeInspection campaign={value} onSelect={() => {}} />);
  assert.match(html, /No ad-level creative supplied/);
  assert.match(html, /Edit in Meta Ads Manager/);
  const invalid = renderToStaticMarkup(<PaidCreativeInspection campaign={{ ...value, accountId: "invalid" }} onSelect={() => {}} />);
  assert.match(invalid, /Provider editing link unavailable/);
  assert.doesNotMatch(invalid, /href=/);
});

test("gallery retains campaign analytics and opens on the previewed creative", () => {
  const html = renderToStaticMarkup(<PaidCreativeGallery campaigns={[campaign()]} onSelect={() => {}} />);
  assert.match(html, /Campaign spend/);
  assert.match(html, /Campaign CTR/);
  assert.match(html, /Open creative details for Test campaign in Test account/);
  assert.match(html, /object-scale-down/);
  assert.match(html, /value="790" selected=""/);
});

test("portal inspection is server-render safe with an initial creative and when closed", () => {
  assert.equal(renderToStaticMarkup(<DrillDownPanel campaign={null} onClose={() => {}} />), "");
  assert.equal(renderToStaticMarkup(<DrillDownPanel campaign={campaign()} initialAdId="790" onClose={() => {}} />), "");
});
