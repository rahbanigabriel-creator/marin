export type RedisEnvironment = Readonly<Record<string, string | undefined>>;

export type RedisRestCredentials = Readonly<{
  url: string;
  token: string;
  source: "upstash" | "vercel_kv";
}>;

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Resolve either Upstash's native names or the names injected by Vercel Marketplace. */
export function resolveRedisRestCredentials(
  env: RedisEnvironment,
): RedisRestCredentials | null {
  const upstashUrl = nonEmpty(env.UPSTASH_REDIS_REST_URL);
  const upstashToken = nonEmpty(env.UPSTASH_REDIS_REST_TOKEN);
  if (upstashUrl && upstashToken) {
    return { url: upstashUrl, token: upstashToken, source: "upstash" };
  }

  const vercelUrl = nonEmpty(env.KV_REST_API_URL);
  const vercelToken = nonEmpty(env.KV_REST_API_TOKEN);
  if (vercelUrl && vercelToken) {
    return { url: vercelUrl, token: vercelToken, source: "vercel_kv" };
  }

  return null;
}
