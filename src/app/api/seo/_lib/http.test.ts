import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceAuthorizationError } from "@/lib/auth";
import { EntitlementDeniedError } from "@/lib/billing/errors";
import {
  SeoBadRequestError,
  SeoConflictError,
  SeoNotFoundError,
  SeoUnavailableError,
  SeoValidationError,
} from "@/lib/seo/errors";

import { readSeoJson, seoApiFailure } from "./http";

test("SEO API failures expose stable status and error contracts", async () => {
  const cases: Array<[unknown, number, string]> = [
    [new SeoBadRequestError("invalid_body", "Bad body"), 400, "invalid_body"],
    [new WorkspaceAuthorizationError(), 403, "forbidden"],
    [new EntitlementDeniedError("credit_limit", "seo_ai_proposal", "Limit reached"), 402, "credit_limit"],
    [new SeoNotFoundError("task"), 404, "not_found"],
    [new SeoConflictError("version_conflict", "Stale", 4), 409, "version_conflict"],
    [new SeoValidationError("invalid_priority", "Bad priority"), 422, "invalid_priority"],
    [new SeoUnavailableError("ai_generation_unavailable", "Not configured"), 503, "ai_generation_unavailable"],
  ];
  for (const [error, status, code] of cases) {
    const response = seoApiFailure(error, "test");
    assert.equal(response.status, status);
    const body = await response.json() as { code: string; currentVersion?: number };
    assert.equal(body.code, code);
    if (code === "version_conflict") assert.equal(body.currentVersion, 4);
  }
});

test("SEO JSON parsing turns invalid JSON into a stable bad-request error", async () => {
  await assert.rejects(
    () => readSeoJson(new Request("https://marpin.test/api/seo/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    })),
    (error: unknown) => error instanceof SeoBadRequestError && error.code === "invalid_body",
  );
});
