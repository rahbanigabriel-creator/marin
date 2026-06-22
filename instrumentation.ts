/**
 * Next.js server instrumentation hook (runs once when the server boots, before
 * any request). Used here to load the Sentry runtime config for the active
 * runtime. Both config modules are no-ops without SENTRY_DSN, so this stays
 * fully graceful with no env — nothing initialises and the build is green.
 *
 * See instrumentation-client.ts for the browser counterpart.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Captures errors thrown in nested React Server Components / route handlers so
 * they reach Sentry. A no-op when Sentry is uninitialised (no DSN), so wiring it
 * in is safe with no env. Referenced by Next.js automatically.
 */
export const onRequestError = Sentry.captureRequestError;
