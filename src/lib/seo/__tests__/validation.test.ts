import assert from "node:assert/strict";
import test from "node:test";

import {
  SeoBadRequestError,
  SeoValidationError,
} from "../errors";
import {
  parseAcceptSeoProposalBody,
  parseCreateSeoTaskBody,
  parseGenerateSeoProposalBody,
  parsePatchSeoTaskBody,
  parseSeoAnalyzeBody,
  parseSeoBrandQuery,
} from "../validation";

test("SEO request parsers return normalized contract values", () => {
  assert.equal(
    parseSeoBrandQuery(new Request("https://marpin.test/api/seo?brandId=%20brand_1%20")),
    "brand_1",
  );
  assert.deepEqual(parseSeoAnalyzeBody({ brandId: " brand_1 " }), { brandId: "brand_1" });
  assert.deepEqual(parseCreateSeoTaskBody({
    brandId: "brand_1",
    requestId: "seo_manual_123",
    title: " Improve the title ",
    description: " Explain the gap ",
    recommendedFix: " Draft a replacement ",
    category: "content",
    severity: "high",
    priority: 12,
  }), {
    brandId: "brand_1",
    requestId: "seo_manual_123",
    title: "Improve the title",
    description: "Explain the gap",
    recommendedFix: "Draft a replacement",
    category: "content",
    severity: "high",
    priority: 12,
  });
  assert.deepEqual(parseGenerateSeoProposalBody({
    expectedVersion: 3,
    requestId: "seo_request_123",
    instruction: " Keep the tone direct ",
  }), {
    expectedVersion: 3,
    requestId: "seo_request_123",
    instruction: "Keep the tone direct",
  });
  assert.deepEqual(parseAcceptSeoProposalBody({ expectedVersion: 3 }), { expectedVersion: 3 });
});

test("SEO parsers reject malformed bodies and unsupported fields", () => {
  assert.throws(
    () => parseSeoAnalyzeBody(null),
    (error: unknown) => error instanceof SeoBadRequestError && error.code === "invalid_body",
  );
  assert.throws(
    () => parseCreateSeoTaskBody({
      brandId: "brand_1",
      requestId: "seo_manual_123",
      title: "Task",
      source: "crawl",
    }),
    (error: unknown) => error instanceof SeoValidationError && error.code === "unknown_field",
  );
  assert.throws(
    () => parseCreateSeoTaskBody({ brandId: "brand_1", title: "Task" }),
    (error: unknown) => error instanceof SeoValidationError && error.code === "invalid_field",
  );
  assert.throws(
    () => parseCreateSeoTaskBody({
      brandId: "brand_1",
      requestId: "short",
      title: "Task",
    }),
    (error: unknown) => error instanceof SeoValidationError && error.code === "invalid_request_id",
  );
  assert.throws(
    () => parseGenerateSeoProposalBody({ expectedVersion: 1, requestId: "short" }),
    (error: unknown) => error instanceof SeoValidationError && error.code === "invalid_request_id",
  );
  assert.throws(
    () => parseSeoBrandQuery(new Request("https://marpin.test/api/seo")),
    (error: unknown) => error instanceof SeoBadRequestError && error.code === "brand_id_required",
  );
});

test("completion notes require an explicit unverified completion transition", () => {
  assert.throws(
    () => parsePatchSeoTaskBody({ expectedVersion: 1, completionNote: "Shipped manually" }),
    (error: unknown) =>
      error instanceof SeoValidationError && error.code === "completion_status_required",
  );
  assert.throws(
    () => parsePatchSeoTaskBody({ expectedVersion: 1, completionNote: null }),
    (error: unknown) =>
      error instanceof SeoValidationError && error.code === "completion_status_required",
  );
  assert.deepEqual(parsePatchSeoTaskBody({
    expectedVersion: 2,
    status: "completed",
    completionNote: "Verified only by the operator",
  }), {
    expectedVersion: 2,
    title: undefined,
    description: undefined,
    recommendedFix: undefined,
    category: undefined,
    severity: undefined,
    priority: undefined,
    status: "completed",
    completionNote: "Verified only by the operator",
  });
});
