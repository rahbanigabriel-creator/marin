import assert from "node:assert/strict";
import test from "node:test";

import { resolveRedisRestCredentials } from "@/lib/cache/redis-config";

test("prefers native Upstash credentials when both supported pairs exist", () => {
  assert.deepEqual(
    resolveRedisRestCredentials({
      UPSTASH_REDIS_REST_URL: " https://native.example ",
      UPSTASH_REDIS_REST_TOKEN: " native-token ",
      KV_REST_API_URL: "https://vercel.example",
      KV_REST_API_TOKEN: "vercel-token",
    }),
    {
      url: "https://native.example",
      token: "native-token",
      source: "upstash",
    },
  );
});

test("accepts the Vercel Marketplace Redis variable names", () => {
  assert.deepEqual(
    resolveRedisRestCredentials({
      KV_REST_API_URL: "https://vercel.example",
      KV_REST_API_TOKEN: "vercel-token",
    }),
    {
      url: "https://vercel.example",
      token: "vercel-token",
      source: "vercel_kv",
    },
  );
});

test("rejects partial, mixed, or blank credential pairs", () => {
  assert.equal(
    resolveRedisRestCredentials({
      UPSTASH_REDIS_REST_URL: "https://native.example",
      KV_REST_API_TOKEN: "vercel-token",
    }),
    null,
  );
  assert.equal(
    resolveRedisRestCredentials({
      KV_REST_API_URL: "   ",
      KV_REST_API_TOKEN: "vercel-token",
    }),
    null,
  );
});
