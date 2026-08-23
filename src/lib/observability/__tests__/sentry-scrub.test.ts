import assert from "node:assert/strict";
import test from "node:test";

import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubTelemetryText,
} from "@/lib/observability/sentry-scrub";

test("scrubs credentials, contact details, and URL query data from text", () => {
  const scrubbed = scrubTelemetryText(
    "user@example.com Bearer abc.def ghi GOCSPX-secret " +
      "postgresql://owner:pass@db.example/app " +
      "https://www.marpin.ai/callback?code=oauth-code&state=private#done",
  );
  assert.equal(scrubbed.includes("user@example.com"), false);
  assert.equal(scrubbed.includes("GOCSPX-secret"), false);
  assert.equal(scrubbed.includes("owner:pass"), false);
  assert.equal(scrubbed.includes("oauth-code"), false);
  assert.equal(scrubbed.includes("state=private"), false);
  assert.match(scrubbed, /https:\/\/www\.marpin\.ai\/callback/);
});

test("removes request bodies, headers, user identity, extras, and breadcrumb data", () => {
  const scrubbed = scrubSentryEvent({
    message: "Provider failed for founder@example.com",
    user: { id: "user_123", email: "founder@example.com" },
    extra: { providerPayload: { access_token: "secret" } },
    request: {
      method: "POST",
      url: "https://www.marpin.ai/api/connect/callback?code=secret",
      headers: { authorization: "Bearer secret" },
      cookies: { session: "secret" },
      data: { prompt: "private strategy" },
      query_string: "code=secret",
    },
    breadcrumbs: [{
      category: "fetch",
      message: "https://provider.test/path?access_token=secret",
      data: { response: "private provider body" },
    }],
  });

  assert.equal("user" in scrubbed, false);
  assert.equal("extra" in scrubbed, false);
  assert.deepEqual(scrubbed.request, {
    method: "POST",
    url: "https://www.marpin.ai/api/connect/callback",
  });
  assert.equal(JSON.stringify(scrubbed).includes("private strategy"), false);
  assert.equal(JSON.stringify(scrubbed).includes("private provider body"), false);
  assert.equal(JSON.stringify(scrubbed).includes("founder@example.com"), false);
  assert.equal(JSON.stringify(scrubbed).includes("access_token=secret"), false);
});

test("breadcrumb scrubbing drops arbitrary data while preserving safe routing context", () => {
  assert.deepEqual(
    scrubSentryBreadcrumb({
      category: "navigation",
      message: "Moved to https://www.marpin.ai/app?brandId=private",
      data: { from: "private" },
    }),
    {
      category: "navigation",
      message: "Moved to https://www.marpin.ai/app",
    },
  );
});
