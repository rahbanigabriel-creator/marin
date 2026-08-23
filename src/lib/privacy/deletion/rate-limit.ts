import "server-only";

import { createHmac } from "node:crypto";

import { NextResponse } from "next/server";

import { getRateLimiter, isRedisConfigured } from "@/lib/cache/redis";

const TOKENS = 4;
const WINDOW = "1 h" as const;

function deployment(): boolean {
  return process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
}

function requesterIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "anonymous"
  ).slice(0, 256);
}

function key(kind: "user" | "ip", value: string, pepper: string): string {
  return `rl:v1:workspace_deletion:${kind}:${createHmac("sha256", pepper)
    .update("marpin-workspace-deletion:v1\0", "utf8")
    .update(kind, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest("hex")}`;
}

function unavailable(): NextResponse {
  return NextResponse.json(
    { error: "service_unavailable", code: "rate_limit_unavailable" },
    { status: 503, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function enforceWorkspaceDeletionRateLimit(input: {
  request: Request;
  clerkUserId: string;
}): Promise<NextResponse | null> {
  const isDeployment = deployment();
  if (!isRedisConfigured()) return isDeployment ? unavailable() : null;
  const pepper = (
    process.env.RATE_LIMIT_KEY_PEPPER ?? process.env.TOKEN_ENC_KEY ?? ""
  ).trim();
  if (pepper.length < 16) return isDeployment ? unavailable() : null;

  const limiter = getRateLimiter({
    tokens: TOKENS,
    window: WINDOW,
    prefix: "marpin:workspace_deletion",
    failClosed: true,
  });
  for (const [kind, value] of [
    ["user", input.clerkUserId],
    ["ip", requesterIp(input.request)],
  ] as const) {
    const result = await limiter.limit(key(kind, value, pepper));
    if (!result.success) {
      const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1_000));
      return NextResponse.json(
        { error: "rate_limited", code: "rate_limit_exceeded" },
        {
          status: 429,
          headers: {
            "Cache-Control": "private, no-store",
            "Retry-After": String(retryAfter),
          },
        },
      );
    }
  }
  return null;
}
