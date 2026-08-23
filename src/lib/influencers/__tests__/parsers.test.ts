import assert from "node:assert/strict";
import test from "node:test";

import { influencerRequestHash } from "@/lib/influencers/hash";
import {
  parseCreateInfluencerBody,
  parseCreateInfluencerTrackingBody,
  parseDisableInfluencerTrackingBody,
  parseInfluencerBrandQuery,
  parsePatchInfluencerBody,
} from "@/lib/influencers/parsers";
import { InfluencerValidationError } from "@/lib/influencers/validation";

const profile = {
  platform: "instagram",
  handle: "@BuildWithAda",
  profileUrl: "https://www.instagram.com/buildwithada/",
  displayName: "Ada Builds",
  contactEmail: "ada@example.com",
  contactName: "Ada",
  topics: ["developer tools"],
  audienceCountries: ["es"],
  notes: null,
  status: "qualified",
  source: "manual",
  metrics: [],
};

test("API envelopes are strict while complete and status-only profile patches remain valid", () => {
  const created = parseCreateInfluencerBody({
    brandId: "brand_123456789",
    requestId: "creator_request_123",
    profile,
  });
  assert.equal(created.profile.handle, "buildwithada");

  assert.deepEqual(
    parsePatchInfluencerBody({ expectedVersion: 2, status: "active" }),
    { expectedVersion: 2, fields: { status: "active" } },
  );
  const complete = parsePatchInfluencerBody({
    expectedVersion: 3,
    ...profile,
  });
  assert.equal(complete.fields.platform, "instagram");

  assert.throws(
    () => parsePatchInfluencerBody({ expectedVersion: 1 }),
    /At least one profile field/,
  );
  assert.throws(
    () => parsePatchInfluencerBody({ expectedVersion: 1, status: "active", workspaceId: "other" }),
    InfluencerValidationError,
  );
});

test("browser envelopes cannot establish vendor provenance", () => {
  assert.throws(
    () => parseCreateInfluencerBody({
      brandId: "brand_123456789",
      requestId: "creator_request_123",
      profile: {
        ...profile,
        metrics: [{
          metric: "audience_size",
          value: 12,
          sourceUrl: "https://www.instagram.com/buildwithada/",
          observedAt: "2026-08-20T00:00:00.000Z",
          source: "vendor",
        }],
      },
    }),
    /configured server adapter/,
  );
  assert.throws(
    () => parsePatchInfluencerBody({ expectedVersion: 1, source: "vendor" }),
    /configured server adapter/,
  );
});

test("tracking and query envelopes reject hidden fields and ambiguous brand scope", () => {
  assert.deepEqual(
    parseCreateInfluencerTrackingBody({
      requestId: "tracking_request_123",
      destinationUrl: "https://www.marpin.ai/offer",
      campaignKey: "launch_week",
    }),
    {
      requestId: "tracking_request_123",
      destinationUrl: "https://www.marpin.ai/offer",
      campaignKey: "launch_week",
    },
  );
  assert.throws(
    () => parseCreateInfluencerTrackingBody({
      requestId: "tracking_request_123",
      destinationUrl: "https://www.marpin.ai",
      campaignKey: "launch",
      profileId: "other",
    }),
    InfluencerValidationError,
  );
  assert.deepEqual(
    parseDisableInfluencerTrackingBody({ expectedVersion: 2 }),
    { expectedVersion: 2 },
  );
  assert.throws(
    () => parseDisableInfluencerTrackingBody({ expectedVersion: 2, enabled: true }),
    InfluencerValidationError,
  );
  assert.equal(
    parseInfluencerBrandQuery(new Request("https://www.marpin.ai/api/influencers?brandId=brand_123456789")),
    "brand_123456789",
  );
  assert.throws(
    () => parseInfluencerBrandQuery(
      new Request("https://www.marpin.ai/api/influencers?brandId=one&brandId=two"),
    ),
    InfluencerValidationError,
  );
});

test("semantic request hashes ignore object key order", () => {
  assert.equal(
    influencerRequestHash({ profile: { handle: "ada", platform: "youtube" }, brandId: "one" }),
    influencerRequestHash({ brandId: "one", profile: { platform: "youtube", handle: "ada" } }),
  );
});
