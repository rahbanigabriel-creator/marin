/**
 * Sentry server-side initialisation (Node.js runtime).
 *
 * Graceful without keys (mirrors src/lib/agent/provider.ts and src/lib/db.ts):
 * Sentry.init() runs ONLY when SENTRY_DSN is present. With no DSN this module
 * imports cleanly and does nothing — no client is constructed, no network call
 * is made, and `next build` / `tsc --noEmit` stay green with no env set.
 *
 * EU data residency: Sentry routes events to the region encoded in the DSN, so
 * point SENTRY_DSN at an EU-region Sentry project (or self-hosted EU instance).
 * No host is hardcoded here.
 *
 * Loaded by instrumentation.ts (the Next.js server instrumentation hook).
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Sample rate for performance tracing. Tune per environment; default low so
    // we don't over-report. Override with SENTRY_TRACES_SAMPLE_RATE.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // Never send PII (IP addresses, headers, cookies) by default.
    sendDefaultPii: false,
    enabled: true,
  });
}
