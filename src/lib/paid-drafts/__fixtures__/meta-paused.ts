import type { MetaPausedSnapshot } from "../meta-paused-contract";

export function metaPausedFixture(connectionId = "connection_meta", accountId = "123456789", assetId = "asset_1"): MetaPausedSnapshot {
  return {
    schemaVersion: 1, source: "manual", platform: "meta_ads", template: "meta_traffic",
    connection: { platform: "meta_ads", connectionId, accountId, accountName: "Test account" },
    campaign: { name: "Test only - paused creation", objective: "traffic" },
    budget: { amountMinor: 500, currency: "EUR", cadence: "daily" },
    schedule: { startsAt: "2099-09-06T09:00:00Z", endsAt: "2099-09-13T09:00:00Z", timezone: "UTC" },
    assumptions: [],
    metaDelivery: { version: 1, pageId: "987654321", pageName: "Test Page", placement: "facebook_feed", specialAdCategory: "none", beneficiary: "Test company", payer: "Test company" },
    adGroups: [{ localId: "group_1", name: "Spain", targeting: { kind: "audience", locations: ["ES"], languages: ["All languages"], ageMin: 18, ageMax: 65, genders: ["all"], interests: [] }, ads: [{ localId: "ad_1", name: "Test image", format: "image", assetIds: [assetId], primaryText: "Plan your week.", headline: "Your next week", description: null, callToAction: "learn_more", destinationUrl: "https://www.marpin.ai/" }] }],
  };
}
