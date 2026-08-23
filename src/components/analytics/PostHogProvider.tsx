"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  ANALYTICS_CONSENT_EVENT,
  parseAnalyticsConsent,
  persistAnalyticsConsent,
  sanitizedPageLocation,
  shouldInitializeBrowserAnalytics,
  type AnalyticsConsent,
} from "@/lib/observability/consent";

type AnalyticsClient = {
  capture(event: string, properties?: Record<string, unknown>): void;
  opt_in_capturing(): void;
  opt_out_capturing(): void;
};

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
  const pathname = usePathname();
  const publicKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const [consent, setConsent] = useState<AnalyticsConsent>("unset");
  const [consentLoaded, setConsentLoaded] = useState(false);
  const [analytics, setAnalytics] = useState<AnalyticsClient | null>(null);

  useEffect(() => {
    setConsent(parseAnalyticsConsent(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)));
    setConsentLoaded(true);
  }, []);

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      setConsent(parseAnalyticsConsent(typeof detail === "string" ? detail : null));
    };
    window.addEventListener(ANALYTICS_CONSENT_EVENT, update);
    return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, update);
  }, []);

  useEffect(() => {
    if (consent === "denied" && analytics) {
      analytics.opt_out_capturing();
      return;
    }
    if (!shouldInitializeBrowserAnalytics({ publicKey, consent })) return;
    if (analytics) {
      analytics.opt_in_capturing();
      return;
    }

    let cancelled = false;
    void import("posthog-js").then(({ default: posthog }) => {
      if (cancelled) return;
      posthog.init(publicKey as string, {
        api_host:
          process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        person_profiles: "never",
      });
      posthog.opt_in_capturing();
      setAnalytics(posthog);
    });

    return () => {
      cancelled = true;
    };
  }, [analytics, consent, publicKey]);

  useEffect(() => {
    if (!analytics || consent !== "granted") return;
    analytics.capture("page_viewed", {
      path: pathname,
      $current_url: sanitizedPageLocation(window.location.origin, pathname),
    });
  }, [analytics, consent, pathname]);

  const choose = (value: Exclude<AnalyticsConsent, "unset">) => {
    persistAnalyticsConsent(window.localStorage, value);
    setConsent(value);
    window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT, { detail: value }));
  };

  return (
    <>
      {children}
      {publicKey && consentLoaded && consent === "unset" ? (
        <aside
          aria-label="Analytics preference"
          className="fixed inset-x-[12px] bottom-[12px] z-[70] mx-auto flex max-w-[720px] flex-col gap-[12px] rounded-[8px] border border-line-2 bg-surface-panel p-[14px] shadow-modal sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="m-0 max-w-[470px] font-sans text-[12.5px] leading-[1.5] text-ink-600">
            Marpin can collect limited, query-free product analytics. Autocapture and session replay stay off. Read the{" "}
            <a href="/privacy" className="font-semibold text-ink-900 underline underline-offset-2">
              privacy policy
            </a>
            .
          </p>
          <div className="flex flex-none gap-[7px]">
            <button
              type="button"
              onClick={() => choose("denied")}
              className="h-[34px] cursor-pointer rounded-[7px] border border-line-2 bg-transparent px-[11px] font-sans text-[12px] font-semibold text-ink-700"
            >
              Essential only
            </button>
            <button
              type="button"
              onClick={() => choose("granted")}
              className="h-[34px] cursor-pointer rounded-[7px] border-none bg-ink-900 px-[11px] font-sans text-[12px] font-semibold text-white"
            >
              Allow analytics
            </button>
          </div>
        </aside>
      ) : null}
    </>
  );
}
