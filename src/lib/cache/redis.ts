import "server-only";

import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/**
 * Cache + rate-limiting (Upstash Redis, Stack C). Server-only.
 *
 * Two capabilities behind one lazily-resolved REST client:
 *   • getRateLimiter() — a sliding-window limiter for request throttling.
 *   • cacheGet/cacheSet — a tiny typed key/value cache helper.
 *
 * Graceful without keys (mirrors src/lib/agent/provider.ts, src/lib/db.ts,
 * src/lib/analytics.ts and src/lib/billing/stripe.ts):
 *   • Importing this module NEVER constructs a client or touches the network.
 *   • The client is lazily created on first use, and ONLY when BOTH
 *     UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are present.
 *   • With no env the rate limiter is a PERMISSIVE no-op (every check returns
 *     allowed) and the cache is a pass-through MISS (get → null, set → no-op) —
 *     nothing throws, so `next build` / `tsc --noEmit` stay green with no env
 *     and no request path can be broken by missing cache config.
 *
 * EU data residency: create the Upstash database in an EU region; the REST URL
 * is bound to that region's endpoint (no host hardcoded here). The SDK targets
 * exactly the URL provided in UPSTASH_REDIS_REST_URL.
 *
 * Security: the REST token is read lazily from env and is NEVER logged.
 */

/** True when Upstash Redis is configured (both REST URL and token present).
 * Read lazily from env on every call — never at import. */
export function isRedisConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

let redis: Redis | null = null;

/**
 * Lazily resolve the Upstash REST client, or null when unconfigured. The client
 * is constructed at most once. Env is read here (not at import) so build stays
 * green with no env. Upstash's REST transport is stateless (no pooled socket),
 * so this is safe to reuse across serverless invocations.
 */
function getRedis(): Redis | null {
  if (!isRedisConfigured()) return null;
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL as string,
      token: process.env.UPSTASH_REDIS_REST_TOKEN as string,
    });
  }
  return redis;
}

/** The subset of a rate-limit decision callers need. Mirrors Upstash's shape so
 * the permissive no-op and the live limiter return the same type. */
export interface RateLimitResult {
  /** True when the request may proceed. Always true when Redis is unconfigured. */
  success: boolean;
  /** Configured request ceiling for the window (0 in the no-op case). */
  limit: number;
  /** Remaining requests in the current window. */
  remaining: number;
  /** Epoch ms at which the window resets. */
  reset: number;
}

/** A rate limiter exposing a single check. Both the live (Upstash-backed) and
 * the no-op implementations satisfy this, so callers never branch on config. */
export interface RateLimiter {
  /** Check (and consume) one unit for `identifier`. Never throws. */
  limit(identifier: string): Promise<RateLimitResult>;
}

/** Permissive limiter used when Upstash is unconfigured: every check passes. */
const NOOP_LIMITER: RateLimiter = {
  async limit(): Promise<RateLimitResult> {
    return { success: true, limit: 0, remaining: 0, reset: 0 };
  },
};

/** Default sliding-window policy. Tune per call site via getRateLimiter args. */
const DEFAULT_LIMIT = 60;
const DEFAULT_WINDOW = "1 m" as const;

/**
 * In-process cache of live Ratelimit instances, keyed by prefix+policy, so each
 * distinct policy constructs its limiter at most once. The no-op path holds no
 * state.
 */
const limiterCache = new Map<string, Ratelimit>();

/**
 * Resolve a sliding-window rate limiter. Returns a PERMISSIVE no-op when Upstash
 * is not configured (every check allowed), so wiring a limit check is always
 * safe and defaults to allowed with no env.
 *
 * @param opts.tokens  Max requests per window (default 60).
 * @param opts.window  Sliding window duration, e.g. "1 m", "10 s" (default "1 m").
 * @param opts.prefix  Redis key prefix to namespace this limiter (default "rl").
 */
export function getRateLimiter(opts?: {
  tokens?: number;
  window?: Parameters<typeof Ratelimit.slidingWindow>[1];
  prefix?: string;
}): RateLimiter {
  const client = getRedis();
  if (!client) return NOOP_LIMITER;

  const tokens = opts?.tokens ?? DEFAULT_LIMIT;
  const window = opts?.window ?? DEFAULT_WINDOW;
  const prefix = opts?.prefix ?? "rl";
  const cacheKey = `${prefix}:${tokens}:${String(window)}`;

  let limiter = limiterCache.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: client,
      limiter: Ratelimit.slidingWindow(tokens, window),
      prefix,
      // Avoid blocking the request on analytics writes; the SDK still records.
      analytics: false,
    });
    limiterCache.set(cacheKey, limiter);
  }

  const live = limiter;
  return {
    async limit(identifier: string): Promise<RateLimitResult> {
      try {
        const r = await live.limit(identifier);
        return {
          success: r.success,
          limit: r.limit,
          remaining: r.remaining,
          reset: r.reset,
        };
      } catch (err) {
        // Fail OPEN: a cache/limiter outage must never block legitimate traffic
        // or break a request path. Log without secrets and allow the request.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[cache] rate limit check failed, allowing request: ${msg}`);
        return { success: true, limit: 0, remaining: 0, reset: 0 };
      }
    },
  };
}

/**
 * Read a cached JSON value, or null on miss / when Redis is unconfigured. Never
 * throws — a cache outage degrades to a miss so callers recompute.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = getRedis();
  if (!client) return null; // pass-through miss
  try {
    // Upstash auto-deserialises JSON values stored via set().
    const value = await client.get<T>(key);
    return value ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[cache] get failed, treating as miss: ${msg}`);
    return null;
  }
}

/**
 * Write a cached JSON value with an optional TTL (seconds). No-op when Redis is
 * unconfigured. Never throws — a failed write is logged and ignored.
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds?: number,
): Promise<void> {
  const client = getRedis();
  if (!client) return; // unconfigured → no-op
  try {
    if (ttlSeconds && ttlSeconds > 0) {
      await client.set(key, value, { ex: ttlSeconds });
    } else {
      await client.set(key, value);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[cache] set failed, skipping: ${msg}`);
  }
}
