import assert from "node:assert/strict";
import test from "node:test";

import { auditFailureMessage } from "../client-error";

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

test("audit failures preserve actionable URL validation messages", () => {
  assert.equal(
    auditFailureMessage(400, {
      error: "Only public HTTP and HTTPS websites can be audited.",
      code: "UNSAFE_URL",
    }),
    "Only public HTTP and HTTPS websites can be audited.",
  );
});
