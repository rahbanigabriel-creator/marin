import { createHmac } from "node:crypto";
export {
  getSameOriginForbiddenDecision,
  validateSameOriginMutation,
  type HeaderSource,
  type SameOriginMutationDecision,
  type SameOriginRejectionReason,
} from "@/lib/security/request-origin";

export type RateLimitEndpoint =
  | "chat"
  | "audit"
  | "image_generation"
  | "influencer_mutation"
  | "plan_generation"
  | "paid_draft_generation"
  | "paid_provider_operation"
  | "sync"
  | "tracking_redirect";

export type RateLimitPolicy = Readonly<{
  tokens: number;
  windowSeconds: number;
}>;

export const RATE_LIMIT_POLICY_CEILINGS = Object.freeze({
  tokens: 60,
  windowSeconds: 3_600,
} as const);

function boundedPolicy(tokens: number, windowSeconds: number): RateLimitPolicy {
  if (
    !Number.isInteger(tokens) ||
    tokens < 1 ||
    tokens > RATE_LIMIT_POLICY_CEILINGS.tokens ||
    !Number.isInteger(windowSeconds) ||
    windowSeconds < 1 ||
    windowSeconds > RATE_LIMIT_POLICY_CEILINGS.windowSeconds
  ) {
    throw new Error("Invalid rate-limit policy");
  }

  return Object.freeze({ tokens, windowSeconds });
}

export const RATE_LIMIT_POLICIES: Readonly<
  Record<RateLimitEndpoint, RateLimitPolicy>
> = Object.freeze({
  chat: boundedPolicy(30, 60),
  audit: boundedPolicy(4, 900),
  image_generation: boundedPolicy(8, 3_600),
  influencer_mutation: boundedPolicy(30, 60),
  plan_generation: boundedPolicy(6, 3_600),
  paid_draft_generation: boundedPolicy(6, 3_600),
  paid_provider_operation: boundedPolicy(12, 60),
  sync: boundedPolicy(12, 300),
  tracking_redirect: boundedPolicy(60, 60),
});

export function getRateLimitPolicy(endpoint: RateLimitEndpoint): RateLimitPolicy {
  return { ...RATE_LIMIT_POLICIES[endpoint] };
}

export type RateLimitIdentifierKind = "user" | "ip" | "workspace";

export function hashRateLimitIdentifier(input: {
  endpoint: RateLimitEndpoint;
  kind: RateLimitIdentifierKind;
  identifier: string;
  pepper: string;
}): string {
  const identifier = input.identifier.trim();
  if (!identifier) throw new Error("Rate-limit identifier is required");
  if (input.pepper.length < 16) {
    throw new Error("Rate-limit identifier pepper is not configured");
  }

  return createHmac("sha256", input.pepper)
    .update("marpin-rate-limit:v1\0", "utf8")
    .update(input.endpoint, "utf8")
    .update("\0", "utf8")
    .update(input.kind, "utf8")
    .update("\0", "utf8")
    .update(identifier, "utf8")
    .digest("hex");
}

export function buildRateLimitKey(input: {
  endpoint: RateLimitEndpoint;
  kind: RateLimitIdentifierKind;
  identifier: string;
  pepper: string;
}): string {
  return `rl:v1:${input.endpoint}:${hashRateLimitIdentifier(input)}`;
}

export type RateLimitAvailabilityDecision =
  | {
      available: true;
      shouldProceed: true;
      mode: "enforced";
    }
  | {
      available: false;
      shouldProceed: true;
      mode: "development_bypass";
    }
  | {
      available: false;
      shouldProceed: false;
      mode: "unavailable";
      status: 503;
      body: {
        error: "service_unavailable";
        code: "rate_limit_unavailable";
      };
    };

export function decideRateLimitAvailability(input: {
  isProduction: boolean;
  redisConfigured: boolean;
}): RateLimitAvailabilityDecision {
  if (input.redisConfigured) {
    return { available: true, shouldProceed: true, mode: "enforced" };
  }

  if (!input.isProduction) {
    return {
      available: false,
      shouldProceed: true,
      mode: "development_bypass",
    };
  }

  return {
    available: false,
    shouldProceed: false,
    mode: "unavailable",
    status: 503,
    body: {
      error: "service_unavailable",
      code: "rate_limit_unavailable",
    },
  };
}
