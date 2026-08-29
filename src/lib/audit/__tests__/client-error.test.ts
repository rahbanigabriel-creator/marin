import assert from "node:assert/strict";
import test from "node:test";

import { auditFailureMessage, readAuditResponse } from "../client-error";

test("audit failures hide infrastructure error identifiers", () => {
  assert.equal(
    auditFailureMessage(503, {
      error: "service_unavailable",
      code: "rate_limit_unavailable",
    }),
    "The audit service is temporarily unavailable. Please try again in a moment.",
  );
});

test("audit failures explain when a website blocks inspection", () => {
  assert.equal(
    auditFailureMessage(422, {
      error: "The website returned HTTP 403.",
      code: "HTTP_ERROR",
    }),
    "This website blocks automated audits or requires sign-in. Try a public page instead.",
  );
});

test("audit failures distinguish missing pages from blocked pages", () => {
  assert.equal(
    auditFailureMessage(422, {
      error: "The website returned HTTP 404.",
      code: "HTTP_ERROR",
    }),
    "This page could not be found. Check the URL or try the website's public homepage.",
  );
});

test("audit failures provide safe URL validation guidance", () => {
  assert.equal(
    auditFailureMessage(400, {
      error: "Only public HTTP and HTTPS websites can be audited.",
      code: "UNSAFE_URL",
    }),
    "Enter a public HTTP or HTTPS website URL and try again.",
  );
});

test("audit failures explain Marpin's own request limit", () => {
  assert.equal(
    auditFailureMessage(429, {
      error: "rate_limited",
      code: "rate_limit_exceeded",
    }),
    "You have reached the audit limit. Wait a few minutes, then try again.",
  );
});

test("audit failures distinguish a temporary website outage", () => {
  assert.equal(
    auditFailureMessage(422, {
      error: "The website returned HTTP 503.",
      code: "HTTP_ERROR",
    }),
    "This website is temporarily unavailable. Try again later or audit another public page.",
  );
});

test("audit failures do not expose unknown server messages", () => {
  assert.equal(
    auditFailureMessage(422, { error: "Database connection failed" }),
    "Marpin could not audit this website. Please try again.",
  );
});

test("audit response parsing fails closed for intermediary and malformed bodies", async () => {
  assert.deepEqual(await readAuditResponse(new Response("<html>Bad gateway</html>")), {});
  assert.deepEqual(await readAuditResponse(new Response("")), {});
  assert.deepEqual(await readAuditResponse(new Response("null")), {});
  assert.deepEqual(
    await readAuditResponse<{ audit: { score: number } }>(
      new Response(JSON.stringify({ audit: { score: 70 } })),
    ),
    { audit: { score: 70 } },
  );
});
