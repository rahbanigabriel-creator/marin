import assert from "node:assert/strict";
import test from "node:test";

import {
  PaidDraftValidationError,
  parsePaidCampaignSnapshotV1,
} from "../validation";

type Template =
  | "google_search_rsa"
  | "meta_traffic"
  | "meta_lead"
  | "tiktok_traffic"
  | "tiktok_conversion";

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function makeSnapshot(template: Template, source: "manual" | "ai" = "manual"): Record<string, unknown> {
  const platform = template.startsWith("google")
    ? "google_ads"
    : template.startsWith("meta")
      ? "meta_ads"
      : "tiktok_ads";
  const objective = template.endsWith("lead")
    ? "leads"
    : template.endsWith("conversion")
      ? "conversions"
      : "traffic";
  const targeting = platform === "google_ads"
    ? {
        kind: "search",
        locations: ["ES"],
        languages: ["en"],
        keywords: [
          { text: "marketing operating system", matchType: "phrase" },
          { text: "ai marketing platform", matchType: "exact" },
        ],
        negativeKeywords: ["agency"],
      }
    : {
        kind: "audience",
        locations: ["ES"],
        languages: ["en"],
        ageMin: 21,
        ageMax: 55,
        genders: ["all"],
        interests: ["software development", "entrepreneurship"],
      };
  const ad = platform === "google_ads"
    ? {
        localId: "ad_1",
        name: "Founder search ad",
        format: "responsive_search",
        assetIds: [],
        headlines: ["Plan Marketing Faster", "One Workspace For Growth", "Marpin For Solo Founders"],
        descriptions: [
          "Plan organic and paid distribution in one focused marketing workspace.",
          "Turn your website into a clear weekly growth plan with Marpin.",
        ],
        destinationUrl: "https://www.marpin.ai/",
        path1: "marketing",
        path2: "planner",
      }
    : platform === "meta_ads"
      ? {
          localId: "ad_1",
          name: "Founder social ad",
          format: template === "meta_lead" ? "video" : "image",
          assetIds: ["asset_1"],
          primaryText: "Your software ships. Marpin helps your distribution keep up.",
          headline: "Plan your next growth week",
          description: "Organic and paid planning in one workspace.",
          callToAction: template === "meta_lead" ? "sign_up" : "learn_more",
          destinationUrl: "https://www.marpin.ai/",
        }
      : {
          localId: "ad_1",
          name: "Founder video ad",
          format: "video",
          assetIds: ["asset_1"],
          primaryText: "Build the product. Let Marpin organize the distribution plan.",
          headline: "Your marketing operating system",
          callToAction: template === "tiktok_conversion" ? "sign_up" : "learn_more",
          destinationUrl: "https://www.marpin.ai/",
        };

  return {
    schemaVersion: 1,
    source,
    platform,
    template,
    connection: {
      platform,
      connectionId: `${platform}_connection_1`,
      accountId: `${platform}_account_1`,
      accountName: "Marpin Spain",
    },
    campaign: { name: "Marpin founder launch", objective },
    budget: { amountMinor: 5_000, currency: "EUR", cadence: "daily" },
    schedule: {
      startsAt: "2026-09-01T09:00:00+02:00",
      endsAt: "2026-09-30T18:00:00+02:00",
      timezone: "Europe/Madrid",
    },
    adGroups: [{ localId: "group_1", name: "Solo founders", targeting, ads: [ad] }],
    assumptions: ["The landing page remains available throughout the campaign."],
  };
}

function expectCode(action: () => unknown, code: string): void {
  assert.throws(
    action,
    (error: unknown) => error instanceof PaidDraftValidationError && error.code === code,
  );
}

test("parses and freezes every supported launch template", () => {
  const templates: Template[] = [
    "google_search_rsa",
    "meta_traffic",
    "meta_lead",
    "tiktok_traffic",
    "tiktok_conversion",
  ];
  for (const template of templates) {
    const parsed = parsePaidCampaignSnapshotV1(makeSnapshot(template));
    assert.equal(parsed.template, template);
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.adGroups), true);
    assert.equal(Object.isFrozen(parsed.adGroups[0]?.ads), true);
  }
});

test("manual and AI drafts share the same strict contract", () => {
  const manual = parsePaidCampaignSnapshotV1(makeSnapshot("meta_traffic", "manual"));
  const ai = parsePaidCampaignSnapshotV1(makeSnapshot("meta_traffic", "ai"));
  assert.equal(manual.source, "manual");
  assert.equal(ai.source, "ai");
  assert.deepEqual({ ...manual, source: "same" }, { ...ai, source: "same" });
});

test("a validated snapshot can be stored and parsed again without changing timezone identity", () => {
  const first = parsePaidCampaignSnapshotV1(makeSnapshot("google_search_rsa"));
  const second = parsePaidCampaignSnapshotV1(first);
  assert.deepEqual(second, first);
  assert.equal(second.schedule.startsAt, "2026-09-01T09:00:00+02:00");
  assert.equal(second.schedule.endsAt, "2026-09-30T18:00:00+02:00");
});

test("rejects unknown and provider-owned browser fields at every level", () => {
  const rootField = makeSnapshot("google_search_rsa");
  rootField.providerCampaignId = "provider_123";
  expectCode(() => parsePaidCampaignSnapshotV1(rootField), "unknown_field");

  const executionField = makeSnapshot("meta_traffic");
  record(executionField).execution = { status: "active" };
  expectCode(() => parsePaidCampaignSnapshotV1(executionField), "unknown_field");

  const nestedResult = makeSnapshot("tiktok_traffic");
  const group = record((nestedResult.adGroups as unknown[])[0]);
  const ad = record((group.ads as unknown[])[0]);
  ad.providerResult = { id: "unsafe" };
  expectCode(() => parsePaidCampaignSnapshotV1(nestedResult), "unknown_field");
});

test("rejects non-positive, floating, and unsafe budgets", () => {
  for (const amount of [-1, 0, 12.5, Number.MAX_SAFE_INTEGER + 1]) {
    const snapshot = makeSnapshot("google_search_rsa");
    record(snapshot.budget).amountMinor = amount;
    expectCode(() => parsePaidCampaignSnapshotV1(snapshot), "invalid_integer");
  }
});

test("rejects unsupported platform, template, and objective combinations", () => {
  const wrongPlatform = makeSnapshot("google_search_rsa");
  wrongPlatform.platform = "meta_ads";
  record(wrongPlatform.connection).platform = "meta_ads";
  expectCode(() => parsePaidCampaignSnapshotV1(wrongPlatform), "unsupported_template");

  const wrongObjective = makeSnapshot("meta_lead");
  record(wrongObjective.campaign).objective = "traffic";
  expectCode(() => parsePaidCampaignSnapshotV1(wrongObjective), "unsupported_template");

  const imageTikTok = makeSnapshot("tiktok_traffic");
  const group = record((imageTikTok.adGroups as unknown[])[0]);
  record((group.ads as unknown[])[0]).format = "image";
  expectCode(() => parsePaidCampaignSnapshotV1(imageTikTok), "invalid_ad_format");
});

test("requires the creative assets, copy, and destination for each template", () => {
  const noAsset = makeSnapshot("meta_traffic");
  const noAssetGroup = record((noAsset.adGroups as unknown[])[0]);
  record((noAssetGroup.ads as unknown[])[0]).assetIds = [];
  expectCode(() => parsePaidCampaignSnapshotV1(noAsset), "array_size");

  const noCopy = makeSnapshot("tiktok_conversion");
  const noCopyGroup = record((noCopy.adGroups as unknown[])[0]);
  record((noCopyGroup.ads as unknown[])[0]).primaryText = " ";
  expectCode(() => parsePaidCampaignSnapshotV1(noCopy), "required");

  const noDestination = makeSnapshot("google_search_rsa");
  const noDestinationGroup = record((noDestination.adGroups as unknown[])[0]);
  record((noDestinationGroup.ads as unknown[])[0]).destinationUrl = "";
  expectCode(() => parsePaidCampaignSnapshotV1(noDestination), "required");
});

test("rejects invalid dates, timezones, URLs, and account mismatches", () => {
  const badDate = makeSnapshot("meta_traffic");
  record(badDate.schedule).startsAt = "2026-02-30T09:00:00+01:00";
  expectCode(() => parsePaidCampaignSnapshotV1(badDate), "invalid_date");

  const badTimezone = makeSnapshot("meta_traffic");
  record(badTimezone.schedule).timezone = "Mars/Olympus";
  expectCode(() => parsePaidCampaignSnapshotV1(badTimezone), "invalid_timezone");

  const insecureUrl = makeSnapshot("meta_traffic");
  const insecureGroup = record((insecureUrl.adGroups as unknown[])[0]);
  record((insecureGroup.ads as unknown[])[0]).destinationUrl = "http://www.marpin.ai";
  expectCode(() => parsePaidCampaignSnapshotV1(insecureUrl), "invalid_url");

  const swappedConnection = makeSnapshot("meta_traffic");
  expectCode(
    () => parsePaidCampaignSnapshotV1(swappedConnection, { expectedConnectionId: "another_connection" }),
    "account_mismatch",
  );
  expectCode(
    () => parsePaidCampaignSnapshotV1(swappedConnection, { expectedAccountId: "another_account" }),
    "account_mismatch",
  );
});

test("rejects localhost, private, and link-local destination hosts", () => {
  const unsafeUrls = [
    "https://localhost/landing",
    "https://10.1.2.3/landing",
    "https://192.168.1.20/landing",
    "https://169.254.4.2/landing",
    "https://[::1]/landing",
    "https://[fe80::1]/landing",
  ];
  for (const destinationUrl of unsafeUrls) {
    const snapshot = makeSnapshot("meta_traffic");
    const group = record((snapshot.adGroups as unknown[])[0]);
    record((group.ads as unknown[])[0]).destinationUrl = destinationUrl;
    expectCode(() => parsePaidCampaignSnapshotV1(snapshot), "unsafe_destination");
  }
});

test("requires schedule offsets to match the IANA timezone at both instants", () => {
  const wrongStartOffset = makeSnapshot("google_search_rsa");
  record(wrongStartOffset.schedule).startsAt = "2026-09-01T09:00:00-05:00";
  expectCode(
    () => parsePaidCampaignSnapshotV1(wrongStartOffset),
    "timezone_offset_mismatch",
  );

  const wrongEndOffsetAcrossDst = makeSnapshot("google_search_rsa");
  record(wrongEndOffsetAcrossDst.schedule).startsAt = "2026-10-24T09:00:00+02:00";
  record(wrongEndOffsetAcrossDst.schedule).endsAt = "2026-10-26T09:00:00+02:00";
  expectCode(
    () => parsePaidCampaignSnapshotV1(wrongEndOffsetAcrossDst),
    "timezone_offset_mismatch",
  );
});

test("bounds campaign text and collection sizes", () => {
  const longName = makeSnapshot("google_search_rsa");
  record(longName.campaign).name = "x".repeat(161);
  expectCode(() => parsePaidCampaignSnapshotV1(longName), "too_long");

  const assumptions = makeSnapshot("google_search_rsa");
  assumptions.assumptions = Array.from({ length: 13 }, (_, index) => `Assumption ${index}`);
  expectCode(() => parsePaidCampaignSnapshotV1(assumptions), "array_size");

  const tooManyGroups = makeSnapshot("meta_traffic");
  const group = record((tooManyGroups.adGroups as unknown[])[0]);
  tooManyGroups.adGroups = Array.from({ length: 21 }, (_, index) => ({
    ...structuredClone(group),
    localId: `group_${index}`,
  }));
  expectCode(() => parsePaidCampaignSnapshotV1(tooManyGroups), "array_size");
});
