import "server-only";

import { NextResponse } from "next/server";

import {
  getRateLimiter,
  isRedisConfigured,
  type RateLimitResult,
} from "@/lib/cache/redis";
import {
  buildRateLimitKey,
  decideRateLimitAvailability,
  getRateLimitPolicy,
  type RateLimitEndpoint,
} from "@/lib/security/request-policy";
import { isolatedE2eBypassAllowed } from "@/lib/security/runtime-config";

function requestIdentifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const value = forwarded || request.headers.get("x-real-ip")?.trim() || "anonymous";
  return value.slice(0, 256);
}

function unavailable(): NextResponse {
  return NextResponse.json(
    { error: "service_unavailable", code: "rate_limit_unavailable" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function rateLimited(reset: number): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1_000));
  return NextResponse.json(
    { error: "rate_limited", code: "rate_limit_exceeded" },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfter),
      },
    },
  );
}

function deploymentEnvironment(): boolean {
  return process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
}

/** Enforces one privacy-safe distributed limit before an expensive mutation. */
export async function enforceEndpointRateLimit(
  request: Request,
  endpoint: RateLimitEndpoint,
): Promise<NextResponse | null> {
  if (isolatedE2eBypassAllowed({
    isVercel: process.env.VERCEL === "1",
    e2eBypass: process.env.MARPIN_E2E === "1",
  })) return null;
  const isDeployment = deploymentEnvironment();
  const availability = decideRateLimitAvailability({
    isProduction: isDeployment,
    redisConfigured: isRedisConfigured(),
  });
  if (!availability.shouldProceed) return unavailable();
  if (!availability.available) return null;

  const configuredPepper = process.env.RATE_LIMIT_KEY_PEPPER ?? process.env.TOKEN_ENC_KEY;
  const pepper = configuredPepper?.trim() || (isDeployment ? "" : "marpin-local-rate-limit-pepper");
  if (pepper.length < 16) return unavailable();

  const policy = getRateLimitPolicy(endpoint);
  const window = `${policy.windowSeconds} s` as const;
  const limiter = getRateLimiter({
    tokens: policy.tokens,
    window,
    prefix: `marpin:${endpoint}`,
    failClosed: true,
  });
  const key = buildRateLimitKey({
    endpoint,
    kind: "ip",
    identifier: requestIdentifier(request),
    pepper,
  });
  const decision = await limiter.limit(key);
  if (decision.success) return null;

  return rateLimited(decision.reset);
}

export interface InfluencerMutationRateLimitDependencies {
  isDeployment?: boolean;
  redisConfigured?: boolean;
  pepper?: string;
  limit?: (identifier: string) => Promise<RateLimitResult>;
}

/** Enforces authenticated per-user and per-workspace influencer mutation limits. */
export async function enforceInfluencerMutationRateLimit(
  input: { userId: string; workspaceId: string },
  dependencies: InfluencerMutationRateLimitDependencies = {},
): Promise<NextResponse | null> {
  return enforceWorkspaceMutationRateLimit("influencer_mutation", input, dependencies);
}

/** Shared across paid preflight, approval and execution, before provider reads. */
export async function enforcePaidProviderRateLimit(
  input: { userId: string; workspaceId: string },
  dependencies: InfluencerMutationRateLimitDependencies = {},
): Promise<NextResponse | null> {
  return enforceWorkspaceMutationRateLimit("paid_provider_operation", input, dependencies);
}

async function enforceWorkspaceMutationRateLimit(
  endpoint: "influencer_mutation" | "paid_provider_operation",
  input: { userId: string; workspaceId: string },
  dependencies: InfluencerMutationRateLimitDependencies,
): Promise<NextResponse | null> {
  if (
    dependencies.isDeployment === undefined &&
    dependencies.redisConfigured === undefined &&
    dependencies.pepper === undefined &&
    dependencies.limit === undefined &&
    isolatedE2eBypassAllowed({
      isVercel: process.env.VERCEL === "1",
      e2eBypass: process.env.MARPIN_E2E === "1",
    })
  ) return null;
  const isDeployment = dependencies.isDeployment ?? deploymentEnvironment();
  const redisConfigured = dependencies.redisConfigured ?? isRedisConfigured();
  const availability = decideRateLimitAvailability({
    isProduction: isDeployment,
    redisConfigured,
  });
  if (!availability.shouldProceed) return unavailable();
  if (!availability.available) return null;

  const configuredPepper =
    dependencies.pepper ??
    process.env.RATE_LIMIT_KEY_PEPPER ??
    process.env.TOKEN_ENC_KEY;
  const pepper = configuredPepper?.trim() ||
    (isDeployment ? "" : "marpin-local-rate-limit-pepper");
  if (pepper.length < 16) return unavailable();

  const policy = getRateLimitPolicy(endpoint);
  const limiter = dependencies.limit
    ? { limit: dependencies.limit }
    : getRateLimiter({
        tokens: policy.tokens,
        window: `${policy.windowSeconds} s`,
        prefix: `marpin:${endpoint}`,
        failClosed: true,
      });
  const identifiers = [
    { kind: "user" as const, identifier: input.userId },
    { kind: "workspace" as const, identifier: input.workspaceId },
  ];

  for (const identifier of identifiers) {
    const key = buildRateLimitKey({ endpoint, pepper, ...identifier });
    const decision = await limiter.limit(key);
    if (!decision.success) return rateLimited(decision.reset);
  }
  return null;
}
