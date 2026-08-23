import assert from "node:assert/strict";
import test from "node:test";

import {
  LAUNCH_CONNECTOR_PLATFORMS,
  ORGANIC_PLATFORM_IDS,
  PAID_PLATFORM_IDS,
  PRODUCT_PLATFORMS,
} from "../platforms";

test("launch scope contains exactly the approved paid and organic destinations", () => {
  assert.deepEqual(PAID_PLATFORM_IDS, ["google_ads", "meta_ads", "tiktok_ads"]);
  assert.deepEqual(ORGANIC_PLATFORM_IDS, [
    "youtube",
    "instagram",
    "facebook",
    "tiktok",
    "snapchat",
    "reddit",
    "pinterest",
  ]);
});

test("only launch-ready data connectors are exposed", () => {
  assert.deepEqual(LAUNCH_CONNECTOR_PLATFORMS, [
    "google_ads",
    "meta_ads",
    "tiktok_ads",
    "ga4",
    "search_console",
  ]);
  const ids = PRODUCT_PLATFORMS.map((platform) => String(platform.id));
  assert.equal(ids.includes("linkedin_ads"), false);
  assert.equal(ids.includes("x_ads"), false);
});

test("organic platforms can draft and use an honest assisted handoff", () => {
  const organic = PRODUCT_PLATFORMS.filter((platform) => platform.section === "organic");
  assert.equal(organic.length, 7);
  for (const platform of organic) {
    assert.equal(platform.capabilities.draft, "available");
    assert.equal(platform.capabilities.schedule, "available");
    assert.equal(platform.capabilities.execute, "assisted");
  }
});

test("paid platforms expose real in-product drafting without claiming provider execution", () => {
  const paid = PRODUCT_PLATFORMS.filter((platform) => platform.section === "paid");
  assert.equal(paid.length, 3);
  for (const platform of paid) {
    assert.equal(platform.capabilities.connect, "available");
    assert.equal(platform.capabilities.draft, "available");
    assert.equal(platform.capabilities.schedule, "planned");
    assert.equal(platform.capabilities.execute, "planned");
  }
});
