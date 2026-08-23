import assert from "node:assert/strict";
import test from "node:test";

import {
  getClerkCspDirectives,
  getSecurityHeaders,
} from "@/lib/security/headers";

function asMap(isProduction: boolean): Map<string, string> {
  return new Map(
    getSecurityHeaders({ isProduction }).map(({ key, value }) => [key, value]),
  );
}

test("returns stable low-risk security headers for app and API responses", () => {
  const headers = asMap(false);

  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(
    headers.get("Referrer-Policy"),
    "strict-origin-when-cross-origin",
  );
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(
    headers.get("Permissions-Policy"),
    "camera=(), geolocation=(), microphone=(), usb=()",
  );
  assert.equal(headers.get("X-DNS-Prefetch-Control"), "off");
  assert.equal(headers.get("X-Permitted-Cross-Domain-Policies"), "none");
  assert.equal(
    headers.get("Cross-Origin-Opener-Policy"),
    "same-origin-allow-popups",
  );
});

test("adds HSTS only for production", () => {
  assert.equal(
    asMap(true).get("Strict-Transport-Security"),
    "max-age=31536000",
  );
  assert.equal(asMap(false).has("Strict-Transport-Security"), false);
});

test("emits unique header names", () => {
  for (const isProduction of [false, true]) {
    const headers = getSecurityHeaders({ isProduction });
    const normalizedNames = headers.map(({ key }) => key.toLowerCase());

    assert.equal(new Set(normalizedNames).size, normalizedNames.length);
  }
});

test("does not expose secrets or grant global cross-origin access", () => {
  const serialized = JSON.stringify(
    getSecurityHeaders({ isProduction: true }),
  ).toLowerCase();

  for (const sensitiveMarker of [
    "secret",
    "token",
    "password",
    "database_url",
    "sk_live_",
    "gocspx-",
  ]) {
    assert.equal(serialized.includes(sensitiveMarker), false);
  }

  const names = new Set(
    getSecurityHeaders({ isProduction: true }).map(({ key }) =>
      key.toLowerCase(),
    ),
  );
  assert.equal(names.has("access-control-allow-origin"), false);
  assert.equal(names.has("access-control-allow-credentials"), false);
});

test("keeps request-specific CSP out of static build headers", () => {
  const names = new Set(
    getSecurityHeaders({ isProduction: true }).map(({ key }) =>
      key.toLowerCase(),
    ),
  );

  assert.equal(names.has("content-security-policy"), false);
  assert.equal(names.has("content-security-policy-report-only"), false);
});

test("strict Clerk CSP additions allow required browser services without leaking DSN credentials", () => {
  const directives = getClerkCspDirectives({
    posthogHost: "https://eu.i.posthog.com/project/path",
    sentryDsn: "https://public-key@o123.ingest.sentry.io/456",
  });

  assert.deepEqual(directives["object-src"], ["none"]);
  assert.deepEqual(directives["frame-ancestors"], ["none"]);
  assert.ok(directives["connect-src"].includes("https://eu.i.posthog.com"));
  assert.ok(directives["connect-src"].includes("https://o123.ingest.sentry.io"));
  assert.ok(directives["img-src"].includes("blob:"));
  assert.equal(JSON.stringify(directives).includes("public-key"), false);
});
