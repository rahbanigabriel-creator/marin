/**
 * Sentry initialisation for the Edge runtime (middleware + edge routes).
 *
 * Same graceful-without-keys contract as sentry.server.config.ts: Sentry.init()
 * runs ONLY when SENTRY_DSN is present, so this module is a no-op with no env
 * and the keyless build stays green. EU residency follows the DSN region.
 *
 * Loaded by instrumentation.ts when NEXT_RUNTIME === "edge".
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    sendDefaultPii: false,
    enabled: true,
  });
}
