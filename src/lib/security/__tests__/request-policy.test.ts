import assert from "node:assert/strict";
import test from "node:test";

import {
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_POLICY_CEILINGS,
  buildRateLimitKey,
  decideRateLimitAvailability,
  getRateLimitPolicy,
  getSameOriginForbiddenDecision,
  hashRateLimitIdentifier,
  validateSameOriginMutation,
  type RateLimitEndpoint,
} from "@/lib/security/request-policy";

const APP_URL = "https://www.marpin.ai";
const PEPPER = "test-only-pepper-with-32-characters";

function validate(
  headers: Readonly<Record<string, string | null | undefined>>,
  overrides: Partial<Parameters<typeof validateSameOriginMutation>[0]> = {},
) {
  return validateSameOriginMutation({
    headers,
    appUrl: APP_URL,
    nextPublicAppUrl: `${APP_URL}/`,
    isProduction: true,
    ...overrides,
  });
}

test("accepts exact canonical origin and equivalent default HTTPS port", () => {
  assert.deepEqual(validate({ Origin: APP_URL }), {
    allowed: true,
    provenance: "origin",
  });
  assert.deepEqual(validate({ origin: `${APP_URL}:443` }), {
    allowed: true,
    provenance: "origin",
  });
  assert.deepEqual(validate({ ORIGIN: "https://WWW.MARPIN.AI" }), {
    allowed: true,
    provenance: "origin",
  });
});

test("rejects lookalike hosts, credentials, alternate ports, and HTTP downgrade", () => {
  for (const origin of [
    "https://www.marpin.ai.evil.example",
    "https://marpin.ai",
    "https://www.marpin.ai@evil.example",
    "https://www.marpin.ai:444",
    "http://www.marpin.ai",
    "https://www.marpin.ai./",
  ]) {
    assert.equal(validate({ origin }).allowed, false, origin);
  }

  assert.deepEqual(
    validate(
      { origin: "https://www.marpin.ai:8443" },
      {
        appUrl: "https://www.marpin.ai:8443",
        nextPublicAppUrl: "https://www.marpin.ai:8443/",
      },
    ),
    { allowed: true, provenance: "origin" },
  );
});

test("uses Referer only when Origin is absent", () => {
  assert.deepEqual(
    validate({ referer: `${APP_URL}/app/calendar?week=next#day` }),
    { allowed: true, provenance: "referer" },
  );

  assert.deepEqual(
    validate({
      origin: "https://evil.example",
      referer: `${APP_URL}/app`,
    }),
    { allowed: false, reason: "cross_origin" },
  );
});

test("rejects malformed, missing, or untrusted forwarded provenance in production", () => {
  assert.deepEqual(validate({}), {
    allowed: false,
    reason: "missing_provenance",
  });
  assert.deepEqual(validate({ referer: "not a URL" }), {
    allowed: false,
    reason: "malformed_referer",
  });
  assert.deepEqual(validate({ origin: `${APP_URL}/unexpected-path` }), {
    allowed: false,
    reason: "malformed_origin",
  });
  assert.deepEqual(
    validate({
      "x-forwarded-host": "www.marpin.ai",
      "x-forwarded-proto": "https",
    }),
    { allowed: false, reason: "missing_provenance" },
  );
});

test("fails closed for missing, malformed, or disagreeing canonical URLs", () => {
  assert.deepEqual(
    validate({ origin: APP_URL }, { appUrl: null, nextPublicAppUrl: null }),
    { allowed: false, reason: "canonical_origin_unconfigured" },
  );
  assert.deepEqual(
    validate(
      { origin: APP_URL },
      { appUrl: "not-a-url", nextPublicAppUrl: APP_URL },
    ),
    { allowed: false, reason: "canonical_origin_invalid" },
  );
  assert.deepEqual(
    validate(
      { origin: APP_URL },
      {
        appUrl: APP_URL,
        nextPublicAppUrl: "https://marpin.ai",
      },
    ),
    { allowed: false, reason: "canonical_origin_mismatch" },
  );
});

test("development override is explicit, non-production, and missing-only", () => {
  assert.deepEqual(
    validate(
      {},
      {
        appUrl: null,
        nextPublicAppUrl: null,
        isProduction: false,
        allowMissingProvenanceInDevelopment: true,
      },
    ),
    { allowed: true, provenance: "development_override" },
  );

  assert.equal(
    validate({}, { isProduction: false }).allowed,
    false,
  );
  assert.equal(
    validate({}, { allowMissingProvenanceInDevelopment: true }).allowed,
    false,
  );
  assert.equal(
    validate(
      { origin: "https://evil.example" },
      {
        isProduction: false,
        allowMissingProvenanceInDevelopment: true,
      },
    ).allowed,
    false,
  );
});

test("returns a stable, URL-free 403 payload", () => {
  const decision = getSameOriginForbiddenDecision();
  assert.deepEqual(decision, {
    status: 403,
    body: { error: "forbidden", code: "invalid_request_origin" },
  });

  const serialized = JSON.stringify(decision).toLowerCase();
  for (const forbiddenFragment of [
    "://",
    "www.",
    "marpin.ai",
    "evil.example",
  ]) {
    assert.equal(serialized.includes(forbiddenFragment), false);
  }
});

test("defines every endpoint policy within immutable global ceilings", () => {
  const expectedEndpoints: RateLimitEndpoint[] = [
    "chat",
    "audit",
    "image_generation",
    "influencer_mutation",
    "paid_draft_generation",
    "paid_provider_operation",
    "plan_generation",
    "sync",
    "tracking_redirect",
  ];

  assert.deepEqual(Object.keys(RATE_LIMIT_POLICIES).sort(), expectedEndpoints.sort());
  assert.equal(Object.isFrozen(RATE_LIMIT_POLICIES), true);

  for (const endpoint of expectedEndpoints) {
    const policy = RATE_LIMIT_POLICIES[endpoint];
    assert.equal(Object.isFrozen(policy), true);
    assert.equal(Number.isInteger(policy.tokens), true);
    assert.equal(Number.isInteger(policy.windowSeconds), true);
    assert.equal(policy.tokens >= 1, true);
    assert.equal(policy.tokens <= RATE_LIMIT_POLICY_CEILINGS.tokens, true);
    assert.equal(policy.windowSeconds >= 1, true);
    assert.equal(
      policy.windowSeconds <= RATE_LIMIT_POLICY_CEILINGS.windowSeconds,
      true,
    );

    const copy = getRateLimitPolicy(endpoint);
    assert.deepEqual(copy, policy);
    assert.notEqual(copy, policy);
  }
});

test("creates deterministic keyed SHA-256 identifiers without raw IDs or IPs", () => {
  const baseInput = {
    endpoint: "chat" as const,
    kind: "user" as const,
    identifier: "user_2abc@example.com",
    pepper: PEPPER,
  };
  const first = hashRateLimitIdentifier(baseInput);
  const second = hashRateLimitIdentifier(baseInput);

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first.includes(baseInput.identifier), false);
  assert.notEqual(first, hashRateLimitIdentifier({ ...baseInput, kind: "ip" }));
  assert.notEqual(
    first,
    hashRateLimitIdentifier({ ...baseInput, endpoint: "audit" }),
  );
  assert.notEqual(
    first,
    hashRateLimitIdentifier({ ...baseInput, pepper: `${PEPPER}-different` }),
  );

  const ip = "203.0.113.42";
  const key = buildRateLimitKey({
    endpoint: "sync",
    kind: "ip",
    identifier: ip,
    pepper: PEPPER,
  });
  assert.match(key, /^rl:v1:sync:[a-f0-9]{64}$/);
  assert.equal(key.includes(ip), false);
});

test("rejects empty identifiers and weak identifier peppers without echoing input", () => {
  assert.throws(
    () =>
      hashRateLimitIdentifier({
        endpoint: "chat",
        kind: "user",
        identifier: " ",
        pepper: PEPPER,
      }),
    /identifier is required/,
  );
  assert.throws(
    () =>
      hashRateLimitIdentifier({
        endpoint: "chat",
        kind: "user",
        identifier: "private-user-id",
        pepper: "short",
      }),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error).message.includes("private-user-id"), false);
      return true;
    },
  );
});

test("fails closed when Redis is unconfigured in production", () => {
  assert.deepEqual(
    decideRateLimitAvailability({
      isProduction: true,
      redisConfigured: false,
    }),
    {
      available: false,
      shouldProceed: false,
      mode: "unavailable",
      status: 503,
      body: {
        error: "service_unavailable",
        code: "rate_limit_unavailable",
      },
    },
  );
});

test("enforces configured Redis and permits an explicit environment-only dev bypass", () => {
  assert.deepEqual(
    decideRateLimitAvailability({
      isProduction: true,
      redisConfigured: true,
    }),
    { available: true, shouldProceed: true, mode: "enforced" },
  );
  assert.deepEqual(
    decideRateLimitAvailability({
      isProduction: false,
      redisConfigured: false,
    }),
    {
      available: false,
      shouldProceed: true,
      mode: "development_bypass",
    },
  );
});
