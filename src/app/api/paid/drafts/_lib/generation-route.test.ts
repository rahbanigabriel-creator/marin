import assert from "node:assert/strict";
import test from "node:test";

import { NextResponse } from "next/server";

import { NotAuthenticatedError } from "@/lib/auth";
import { EntitlementDeniedError } from "@/lib/billing/errors";
import {
  createPaidDraftGenerationPostHandler,
  type PaidDraftGenerationRouteDependencies,
} from "@/app/api/paid/drafts/_lib/generation-route";
import {
  PaidDraftNotFoundError,
  PaidDraftUnavailableError,
} from "@/lib/paid-drafts/errors";

const BODY = {
  requestId: "request_generation_001",
  connectionId: "connection_001",
  template: "google_search_rsa" as const,
  instruction: "Draft a grounded founder campaign.",
};

function request(): Request {
  return new Request("https://www.marpin.ai/api/paid/drafts/generate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://www.marpin.ai",
    },
    body: JSON.stringify(BODY),
  });
}

function routeDependencies(
  overrides: Partial<PaidDraftGenerationRouteDependencies> = {},
): PaidDraftGenerationRouteDependencies {
  return {
    originFailure: () => null,
    databaseUnavailable: () => null,
    requireAccess: async () => ({
      workspace: {
        id: "workspace_001",
        name: "Marpin",
        slug: "marpin",
        isDev: false,
      },
      clerkUserId: "user_001",
      role: "owner",
    }),
    rateLimit: async () => null,
    readJson: async () => BODY,
    generate: async () => ({
      draft: { id: "draft_001" } as never,
      replayed: false,
      credits: 1,
      model: "claude-sonnet-4-6",
    }),
    ...overrides,
  };
}

test("generation route authenticates before rate limiting, body work, or generation", async () => {
  const order: string[] = [];
  const handler = createPaidDraftGenerationPostHandler(
    routeDependencies({
      requireAccess: async () => {
        order.push("auth");
        throw new NotAuthenticatedError();
      },
      rateLimit: async () => {
        order.push("rate");
        return null;
      },
      readJson: async () => {
        order.push("body");
        return BODY;
      },
      generate: async () => {
        order.push("generate");
        throw new Error("must not run");
      },
    }),
  );
  const response = await handler(request());
  assert.equal(response.status, 401);
  assert.deepEqual(order, ["auth"]);
});

test("same-origin rejection happens before authentication", async () => {
  let authenticated = false;
  const handler = createPaidDraftGenerationPostHandler(
    routeDependencies({
      originFailure: () =>
        NextResponse.json(
          { error: "forbidden", code: "cross_origin_forbidden" },
          { status: 403 },
        ),
      requireAccess: async () => {
        authenticated = true;
        throw new Error("must not run");
      },
    }),
  );
  const response = await handler(request());
  assert.equal(response.status, 403);
  assert.equal(authenticated, false);
});

test("successful create and replay return truthful status codes with no-store", async () => {
  for (const [replayed, status] of [
    [false, 201],
    [true, 200],
  ] as const) {
    const handler = createPaidDraftGenerationPostHandler(
      routeDependencies({
        generate: async () => ({
          draft: { id: "draft_001" } as never,
          replayed,
          credits: 1,
          model: "claude-sonnet-4-6",
        }),
      }),
    );
    const response = await handler(request());
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = (await response.json()) as { replayed: boolean };
    assert.equal(body.replayed, replayed);
  }
});

test("strict parsing rejects unknown fields before generation", async () => {
  let generated = false;
  const handler = createPaidDraftGenerationPostHandler(
    routeDependencies({
      readJson: async () => ({ ...BODY, debug: true }),
      generate: async () => {
        generated = true;
        throw new Error("must not run");
      },
    }),
  );
  const response = await handler(request());
  assert.equal(response.status, 422);
  assert.equal(generated, false);
  assert.equal(((await response.json()) as { code: string }).code, "unknown_field");
});

test("tenant misses remain indistinguishable", async () => {
  const handler = createPaidDraftGenerationPostHandler(
    routeDependencies({
      generate: async () => {
        throw new PaidDraftNotFoundError();
      },
    }),
  );
  const response = await handler(request());
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "not_found",
    code: "not_found",
    message: "Paid campaign draft not found",
  });
});

test("provider, model, and entitlement failures expose only sanitized responses", async () => {
  const cases = [
    {
      error: new PaidDraftUnavailableError(
        "ai_provider_unavailable",
        "secret provider setup detail",
      ),
      status: 503,
      code: "ai_provider_unavailable",
      forbidden: "secret provider setup detail",
    },
    {
      error: new PaidDraftUnavailableError(
        "invalid_model_output",
        "raw model included a token and hostile URL",
      ),
      status: 502,
      code: "invalid_model_output",
      forbidden: "hostile URL",
    },
    {
      error: new EntitlementDeniedError(
        "credit_limit",
        "paid_campaign_generation",
        "AI credit limit reached",
      ),
      status: 402,
      code: "credit_limit",
      forbidden: "never-present",
    },
  ] as const;

  for (const entry of cases) {
    const handler = createPaidDraftGenerationPostHandler(
      routeDependencies({
        generate: async () => {
          throw entry.error;
        },
      }),
    );
    const response = await handler(request());
    const text = await response.text();
    assert.equal(response.status, entry.status);
    assert.equal((JSON.parse(text) as { code: string }).code, entry.code);
    assert.doesNotMatch(text, new RegExp(entry.forbidden));
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});
