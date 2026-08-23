import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalPaidCampaignSnapshotJson,
  diffPaidCampaignSnapshotsV1,
  hashPaidCampaignSnapshotV1,
} from "../hash";
import { PaidDraftValidationError } from "../validation";

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function googleSnapshot(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    source: "manual",
    platform: "google_ads",
    template: "google_search_rsa",
    connection: {
      platform: "google_ads",
      connectionId: "google_connection_1",
      accountId: "google_account_1",
      accountName: "Marpin Spain",
    },
    campaign: { name: "Marpin founder launch", objective: "traffic" },
    budget: { amountMinor: 5_000, currency: "EUR", cadence: "daily" },
    schedule: {
      startsAt: "2026-09-01T09:00:00+02:00",
      endsAt: "2026-09-30T18:00:00+02:00",
      timezone: "Europe/Madrid",
    },
    adGroups: [
      {
        localId: "group_1",
        name: "Solo founders",
        targeting: {
          kind: "search",
          locations: ["ES", "PT"],
          languages: ["en"],
          keywords: [
            { text: "marketing operating system", matchType: "phrase" },
            { text: "ai marketing platform", matchType: "exact" },
          ],
          negativeKeywords: ["agency"],
        },
        ads: [
          {
            localId: "ad_1",
            name: "Founder search ad",
            format: "responsive_search",
            assetIds: [],
            headlines: [
              "Plan Marketing Faster",
              "One Workspace For Growth",
              "Marpin For Solo Founders",
            ],
            descriptions: [
              "Plan organic and paid distribution in one focused marketing workspace.",
              "Turn your website into a clear weekly growth plan with Marpin.",
            ],
            destinationUrl: "https://www.marpin.ai/",
            path1: "marketing",
            path2: "planner",
          },
        ],
      },
    ],
    assumptions: ["The landing page stays live.", "The budget is approved internally."],
  };
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => reverseObjectKeys(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, child]) => [key, reverseObjectKeys(child)]),
  );
}

test("canonical JSON and SHA-256 ignore object-key order", () => {
  const snapshot = googleSnapshot();
  const reordered = reverseObjectKeys(snapshot);
  assert.equal(canonicalPaidCampaignSnapshotJson(snapshot), canonicalPaidCampaignSnapshotJson(reordered));
  assert.equal(hashPaidCampaignSnapshotV1(snapshot), hashPaidCampaignSnapshotV1(reordered));
  assert.match(hashPaidCampaignSnapshotV1(snapshot), /^[a-f0-9]{64}$/);
});

test("hash changes for semantic fields and array order", () => {
  const original = googleSnapshot();
  const originalHash = hashPaidCampaignSnapshotV1(original);
  const variants: Record<string, unknown>[] = [];

  const source = structuredClone(original);
  source.source = "ai";
  variants.push(source);

  const account = structuredClone(original);
  record(account.connection).accountName = "Marpin France";
  variants.push(account);

  const campaign = structuredClone(original);
  record(campaign.campaign).name = "A different launch";
  variants.push(campaign);

  const budget = structuredClone(original);
  record(budget.budget).amountMinor = 5_001;
  variants.push(budget);

  const schedule = structuredClone(original);
  record(schedule.schedule).endsAt = "2026-09-29T18:00:00+02:00";
  variants.push(schedule);

  const targeting = structuredClone(original);
  const targetingGroup = record((targeting.adGroups as unknown[])[0]);
  record(targetingGroup.targeting).locations = ["PT", "ES"];
  variants.push(targeting);

  const creative = structuredClone(original);
  const creativeGroup = record((creative.adGroups as unknown[])[0]);
  const creativeAd = record((creativeGroup.ads as unknown[])[0]);
  creativeAd.headlines = [
    "One Workspace For Growth",
    "Plan Marketing Faster",
    "Marpin For Solo Founders",
  ];
  variants.push(creative);

  const assumptions = structuredClone(original);
  assumptions.assumptions = ["The budget is approved internally.", "The landing page stays live."];
  variants.push(assumptions);

  for (const variant of variants) {
    assert.notEqual(hashPaidCampaignSnapshotV1(variant), originalHash);
  }
});

test("exact diff identifies budget, schedule, targeting, and creative changes", () => {
  const before = googleSnapshot();
  const after = structuredClone(before);
  record(after.budget).amountMinor = 7_500;
  record(after.schedule).endsAt = "2026-10-01T18:00:00+02:00";
  const group = record((after.adGroups as unknown[])[0]);
  const targeting = record(group.targeting);
  record((targeting.keywords as unknown[])[0]).text = "distribution operating system";
  const ad = record((group.ads as unknown[])[0]);
  (ad.headlines as unknown[])[0] = "Build Distribution Faster";

  const diffs = diffPaidCampaignSnapshotsV1(before, after);
  assert.deepEqual(
    diffs.map(({ path, category, kind }) => ({ path, category, kind })),
    [
      { path: "adGroups[0].ads[0].headlines[0]", category: "creative", kind: "changed" },
      {
        path: "adGroups[0].targeting.keywords[0].text",
        category: "targeting",
        kind: "changed",
      },
      { path: "budget.amountMinor", category: "budget", kind: "changed" },
      { path: "schedule.endsAt", category: "schedule", kind: "changed" },
    ],
  );
});

test("hashing and diffing reject unvalidated secret or provider result fields", () => {
  const unsafe = googleSnapshot();
  unsafe.clientSecret = "must-not-leak";
  assert.throws(
    () => hashPaidCampaignSnapshotV1(unsafe),
    (error: unknown) => error instanceof PaidDraftValidationError && error.code === "unknown_field",
  );
  assert.throws(
    () => diffPaidCampaignSnapshotsV1(googleSnapshot(), unsafe),
    (error: unknown) => error instanceof PaidDraftValidationError && error.code === "unknown_field",
  );
});
