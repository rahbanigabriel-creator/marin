"use client";

import { useEffect, useState } from "react";

import {
  ANALYTICS_CONSENT_EVENT,
  ANALYTICS_CONSENT_STORAGE_KEY,
  parseAnalyticsConsent,
  persistAnalyticsConsent,
  type AnalyticsConsent,
} from "@/lib/observability/consent";

export function AnalyticsPreferenceControl() {
  const [consent, setConsent] = useState<AnalyticsConsent>("unset");

  useEffect(() => {
    setConsent(parseAnalyticsConsent(localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)));
  }, []);

  const choose = (value: Exclude<AnalyticsConsent, "unset">) => {
    persistAnalyticsConsent(localStorage, value);
    setConsent(value);
    window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT, { detail: value }));
  };

  return (
    <div className="my-[18px] border-l-[3px] border-plum bg-plum-soft px-[14px] py-[12px]">
      <p className="m-0 font-sans text-[13px] leading-[1.55] text-ink-700" role="status">
        Browser analytics: {consent === "granted" ? "allowed" : "off"}.
      </p>
      <div className="mt-[9px] flex flex-wrap gap-[7px]">
        <button
          type="button"
          onClick={() => choose("denied")}
          aria-pressed={consent === "denied"}
          className="h-[34px] cursor-pointer rounded-[7px] border border-line-2 bg-surface-card px-[11px] font-sans text-[12px] font-semibold text-ink-700"
        >
          Essential only
        </button>
        <button
          type="button"
          onClick={() => choose("granted")}
          aria-pressed={consent === "granted"}
          className="h-[34px] cursor-pointer rounded-[7px] border-none bg-ink-900 px-[11px] font-sans text-[12px] font-semibold text-white"
        >
          Allow analytics
        </button>
      </div>
    </div>
  );
}
