import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton (Stack B data layer). Server-only.
 *
 * Hot-reload safety: Next.js dev re-evaluates modules on every change, which
 * would otherwise spin up a new PrismaClient (and a new connection pool) each
 * time and exhaust the database. We cache the instance on globalThis so dev
 * reuses one client; in production a fresh module graph means a single client.
 *
 * Graceful without keys (mirrors src/lib/agent/provider.ts): constructing
 * PrismaClient does NOT open a connection — Prisma connects lazily on the first
 * query. So importing `prisma` is safe with no DATABASE_URL set; only an actual
 * query against an unconfigured database throws, at call time, never at import
 * or build time. Callers should feature-detect with `isDatabaseConfigured()`
 * and fall back to the canned "Sample" data path when it returns false.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * True when a database connection string is configured. Use this to gate any
 * live DB read so the app stays green (and falls back to Sample data) when no
 * DATABASE_URL is present — same feature-detection pattern as the live agent.
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
