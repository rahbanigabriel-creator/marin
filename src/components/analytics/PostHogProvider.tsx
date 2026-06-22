"use client";

import { useEffect } from "react";

/**
 * Client-side PostHog initialiser (Stack C, browser analytics via posthog-js).
 *
 * Graceful without keys: this component initialises posthog-js ONLY when
 * NEXT_PUBLIC_POSTHOG_KEY is present. With no key it renders {children}
 * unchanged and never imports/initialises the browser SDK — so the validated
 * mockup is byte-identical and nothing loads at runtime. posthog-js is imported
 * dynamically inside the effect so the SDK is never pulled into the client
 * bundle's critical path when analytics is off.
 *
 * EU data residency: defaults to the PostHog EU ingestion host
 * (https://eu.i.posthog.com); override only with another EU host via
 * NEXT_PUBLIC_POSTHOG_HOST.
 *
 * Mounted conditionally from app/layout.tsx (see isAnalyticsConfigured()).
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return; // unconfigured → no init, no network

    let cancelled = false;
    // Dynamic import keeps posthog-js out of the bundle until analytics is on.
    void import("posthog-js").then(({ default: posthog }) => {
      if (cancelled) return;
      posthog.init(key, {
        api_host:
          process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
        // Privacy-forward defaults; capture pageviews/leaves automatically.
        capture_pageview: true,
        capture_pageleave: true,
        person_profiles: "identified_only",
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return <>{children}</>;
}
