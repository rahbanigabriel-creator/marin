import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * Ship the doctrine corpus markdown with the serverless trace.
   *
   * src/lib/rag/corpus.ts reads src/lib/rag/corpus/*.md at runtime via a dynamic
   * readdirSync path (resolved from import.meta.url). Next's file tracer cannot
   * statically follow a dynamic readdir, so on a standalone / Vercel serverless
   * build the .md files would NOT be bundled — loadCorpus() would silently return
   * [] and the zero-connector brain would lose ALL doctrine grounding in prod
   * (invisible at build time because the loader degrades gracefully).
   *
   * Pinning the glob here forces every route that can reach the retriever to
   * include the corpus in its trace. We key it broadly (the chat API route plus a
   * catch-all) so the corpus rides along wherever loadCorpus is reachable.
   */
  outputFileTracingIncludes: {
    "/api/chat": ["./src/lib/rag/corpus/**/*.md"],
    "/api/**/*": ["./src/lib/rag/corpus/**/*.md"],
    "/**/*": ["./src/lib/rag/corpus/**/*.md"],
  },
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
