import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAnalyticsConsent,
  persistAnalyticsConsent,
  sanitizedPageLocation,
  shouldInitializeBrowserAnalytics,
} from "@/lib/observability/consent";

test("browser analytics require both a public key and explicit grant", () => {
  assert.equal(shouldInitializeBrowserAnalytics({ publicKey: "phc_test", consent: "granted" }), true);
  assert.equal(shouldInitializeBrowserAnalytics({ publicKey: "phc_test", consent: "denied" }), false);
  assert.equal(shouldInitializeBrowserAnalytics({ publicKey: "phc_test", consent: "unset" }), false);
  assert.equal(shouldInitializeBrowserAnalytics({ publicKey: "", consent: "granted" }), false);
});

test("consent parsing fails closed and page locations omit query and fragment data", () => {
  assert.equal(parseAnalyticsConsent("granted"), "granted");
  assert.equal(parseAnalyticsConsent("denied"), "denied");
  assert.equal(parseAnalyticsConsent("yes"), "unset");
  assert.equal(parseAnalyticsConsent(null), "unset");
  assert.equal(
    sanitizedPageLocation("https://www.marpin.ai?ignored=yes", "/app?brandId=private#task"),
    "https://www.marpin.ai/app",
  );
});

test("consent persistence writes only the normalized decision", () => {
  const writes: Array<[string, string]> = [];
  persistAnalyticsConsent({
    setItem(key, value) {
      writes.push([key, value]);
    },
  }, "denied");
  assert.deepEqual(writes, [["marpin_analytics_consent", "denied"]]);
});
