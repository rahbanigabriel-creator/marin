import assert from "node:assert/strict";
import test from "node:test";
import { enforcePaidProviderRateLimit } from "@/lib/security/rate-limit";
import { getRateLimitPolicy } from "@/lib/security/request-policy";

test("paid provider reads and writes share bounded private user and workspace limits", async () => {
  const keys: string[] = [];
  assert.deepEqual(getRateLimitPolicy("paid_provider_operation"), { tokens: 12, windowSeconds: 60 });
  const response = await enforcePaidProviderRateLimit({ userId: "private-user", workspaceId: "private-workspace" }, {
    isDeployment: true, redisConfigured: true, pepper: "test-only-pepper-with-32-characters",
    limit: async (key) => {
      keys.push(key);
      return { success: keys.length === 1, limit: 12, remaining: 0, reset: Date.now() + 30_000 };
    },
  });
  assert.equal(response?.status, 429);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.ok(keys.every((key) => key.startsWith("rl:v1:paid_provider_operation:")));
  assert.ok(!keys.join("").includes("private-"));
  assert.match(response?.headers.get("retry-after") ?? "", /^\d+$/);
});

test("paid provider throttle fails closed in production without Redis or a private key", async () => {
  for (const dependencies of [
    { isDeployment: true, redisConfigured: false, pepper: "test-only-pepper-with-32-characters" },
    { isDeployment: true, redisConfigured: true, pepper: "short" },
  ]) {
    const response = await enforcePaidProviderRateLimit({ userId: "u", workspaceId: "w" }, dependencies);
    assert.equal(response?.status, 503);
    assert.equal(response?.headers.get("cache-control"), "no-store");
  }
});
