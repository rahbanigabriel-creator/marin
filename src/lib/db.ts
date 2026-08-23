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
 * and return an explicit unavailable state when it returns false. Sample data
 * is reserved for the separate, opt-in demo mode.
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
 * live DB read so local builds stay green without a connection. Deployed
 * production is separately required to fail closed when this is false.
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
