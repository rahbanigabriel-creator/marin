import assert from "node:assert/strict";
import test from "node:test";

import { connectorCallbackUrl, connectorReturnUrl } from "./_lib/urls";

test("connector callback URL uses the canonical production origin exactly", () => {
  assert.equal(
    connectorCallbackUrl(
      "https://preview.example.test/api/connect/google_ads",
      "google_ads",
      { APP_URL: "https://www.marpin.ai/an-ignored-path" },
    ),
    "https://www.marpin.ai/api/connect/google_ads/callback",
  );
});

test("connector callback URL falls back safely when a configured URL is invalid", () => {
  assert.equal(
    connectorCallbackUrl(
      "http://localhost:3000/api/connect/meta_ads",
      "meta_ads",
      { APP_URL: "not a URL", NEXT_PUBLIC_APP_URL: "https://www.marpin.ai" },
    ),
    "https://www.marpin.ai/api/connect/meta_ads/callback",
  );
});

test("production never derives an OAuth redirect from the incoming host", () => {
  assert.equal(
    connectorCallbackUrl(
      "https://untrusted.example/api/connect/google_ads",
      "google_ads",
      { APP_URL: "http://www.marpin.ai", NODE_ENV: "production" },
    ),
    "https://www.marpin.ai/api/connect/google_ads/callback",
  );
});

test("connector return URL lands in the paid product with a stable status", () => {
  const result = new URL(connectorReturnUrl(
    "https://preview.example.test/api/connect/meta_ads/callback",
    "consent_denied",
    "meta_ads",
    { APP_URL: "https://www.marpin.ai" },
  ));

  assert.equal(result.origin, "https://www.marpin.ai");
  assert.equal(result.pathname, "/app");
  assert.equal(result.searchParams.get("mode"), "paid");
  assert.equal(result.searchParams.get("view"), "campaigns");
  assert.equal(result.searchParams.get("connect"), "consent_denied");
  assert.equal(result.searchParams.get("platform"), "meta_ads");
});
