/**
 * Sentry browser-side initialisation (Next.js client instrumentation hook).
 *
 * Graceful without keys: Sentry.init() runs ONLY when a public DSN is present
 * (NEXT_PUBLIC_SENTRY_DSN). With no DSN nothing initialises, no SDK transport is
 * created, and the validated mockup renders exactly as before. The DSN is public
 * by design (it only authorises event ingestion), hence the NEXT_PUBLIC_ prefix.
 *
 * EU data residency follows the DSN's region. No host is hardcoded.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    sendDefaultPii: false,
    enabled: true,
  });
}

// Required by @sentry/nextjs to instrument client-side navigations. Safe no-op
// when Sentry is uninitialised.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
