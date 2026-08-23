import assert from "node:assert/strict";
import test from "node:test";

import {
  assertInfluencerTrackingDestination,
  createInfluencerTrackingLink,
  influencerTrackingExpiresAt,
} from "@/lib/influencers/tracking";
import { InfluencerValidationError } from "@/lib/influencers/validation";

test("tracking links are opaque and add bounded campaign attribution", () => {
  const link = createInfluencerTrackingLink({
    destinationUrl: "https://www.marpin.ai/product?ref=creator#ignored",
    campaignKey: "launch_week",
    influencerKey: "creator_42",
    platform: "youtube",
  }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGH");
  const tagged = new URL(link.taggedDestinationUrl);
  assert.equal(link.slug, "abcdefghijklmnopqrstuvwxyzABCDEFGH");
  assert.equal(tagged.hash, "");
  assert.equal(tagged.searchParams.get("ref"), "creator");
  assert.equal(tagged.searchParams.get("utm_source"), "youtube");
  assert.equal(tagged.searchParams.get("utm_medium"), "influencer");
  assert.equal(tagged.searchParams.get("utm_campaign"), "launch_week");
  assert.equal(tagged.searchParams.get("utm_content"), "creator_42");
});

test("tracking destinations and keys fail closed", () => {
  assert.throws(
    () => createInfluencerTrackingLink({
      destinationUrl: "http://localhost:3000/private",
      campaignKey: "launch",
      influencerKey: "creator",
      platform: "tiktok",
    }),
    InfluencerValidationError,
  );
  assert.throws(
    () => createInfluencerTrackingLink({
      destinationUrl: "https://127.0.0.1/admin",
      campaignKey: "launch",
      influencerKey: "creator",
      platform: "tiktok",
    }),
    InfluencerValidationError,
  );
  assert.throws(
    () => createInfluencerTrackingLink({
      destinationUrl: "https://campaign.internal",
      campaignKey: "launch",
      influencerKey: "creator",
      platform: "tiktok",
    }),
    InfluencerValidationError,
  );
  assert.throws(
    () => createInfluencerTrackingLink({
      destinationUrl: "https://www.marpin.ai",
      campaignKey: "../../admin",
      influencerKey: "creator",
      platform: "tiktok",
    }),
    InfluencerValidationError,
  );
});

test("tracking destinations stay on the configured brand host", () => {
  assert.doesNotThrow(() => assertInfluencerTrackingDestination(
    "https://offers.marpin.ai/founder",
    "https://www.marpin.ai",
  ));
  assert.doesNotThrow(() => assertInfluencerTrackingDestination(
    "https://marpin.ai/pricing",
    "https://www.marpin.ai",
  ));
  assert.throws(
    () => assertInfluencerTrackingDestination(
      "https://marpin.ai.attacker.example/phish",
      "https://marpin.ai",
    ),
    (error: unknown) => error instanceof InfluencerValidationError && error.code === "destination_not_owned",
  );
  assert.throws(
    () => assertInfluencerTrackingDestination("https://example.com", null),
    (error: unknown) => error instanceof InfluencerValidationError && error.code === "brand_website_required",
  );
});

test("public suffixes cannot become tracking ownership boundaries", () => {
  for (const brandWebsiteUrl of [
    "https://co.uk",
    "https://www.co.uk",
    "https://com.au",
    "https://github.io",
    "https://vercel.app",
  ]) {
    assert.throws(
      () => assertInfluencerTrackingDestination(
        `https://attacker.${new URL(brandWebsiteUrl).hostname.replace(/^www\./, "")}/offer`,
        brandWebsiteUrl,
      ),
      (error: unknown) =>
        error instanceof InfluencerValidationError &&
        error.code === "invalid_brand_domain",
      brandWebsiteUrl,
    );
  }

  assert.doesNotThrow(() => assertInfluencerTrackingDestination(
    "https://offers.marpin.co.uk/founder",
    "https://www.marpin.co.uk",
  ));
  assert.doesNotThrow(() => assertInfluencerTrackingDestination(
    "https://offers.marpin.com.au/founder",
    "https://marpin.com.au",
  ));
  assert.doesNotThrow(() => assertInfluencerTrackingDestination(
    "https://offers.abc.es/founder",
    "https://abc.es",
  ));
  assert.throws(
    () => assertInfluencerTrackingDestination(
      "https://evil.co.uk/offer",
      "https://marpin.co.uk",
    ),
    (error: unknown) =>
      error instanceof InfluencerValidationError &&
      error.code === "destination_not_owned",
  );
});

test("tracking links receive a deterministic 180-day expiry", () => {
  assert.equal(
    influencerTrackingExpiresAt(new Date("2026-08-20T09:00:00.000Z")).toISOString(),
    "2027-02-16T09:00:00.000Z",
  );
});
