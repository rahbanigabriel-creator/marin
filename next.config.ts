import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

/**
 * Sentry build-time wrapper (source-map upload, tunnelling, tree-shaking).
 *
 * Graceful without keys: we wrap with withSentryConfig ONLY when Sentry is
 * configured for builds (an auth token + org + project are present). With no
 * Sentry env the plain nextConfig is exported unchanged, so `next build` stays
 * green and identical to today — the wrapper never runs and never attempts a
 * source-map upload. silent:true keeps the wrapper from logging when active.
 *
 * EU data residency: configure the Sentry project in an EU region; the wrapper
 * uploads to whatever region the org/project lives in (no host hardcoded here).
 */
const sentryBuildConfigured =
  Boolean(process.env.SENTRY_AUTH_TOKEN) &&
  Boolean(process.env.SENTRY_ORG) &&
  Boolean(process.env.SENTRY_PROJECT);

export default sentryBuildConfigured
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
    })
  : nextConfig;
