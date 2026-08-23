export const ANALYTICS_CONSENT_STORAGE_KEY = "marpin_analytics_consent";
export const ANALYTICS_CONSENT_EVENT = "marpin:analytics-consent";

export type AnalyticsConsent = "granted" | "denied" | "unset";

export function parseAnalyticsConsent(value: string | null | undefined): AnalyticsConsent {
  if (value === "granted" || value === "denied") return value;
  return "unset";
}

export function persistAnalyticsConsent(
  storage: Pick<Storage, "setItem">,
  consent: Exclude<AnalyticsConsent, "unset">,
): void {
  storage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, consent);
}

export function shouldInitializeBrowserAnalytics(input: {
  publicKey: string | null | undefined;
  consent: AnalyticsConsent;
}): boolean {
  return Boolean(input.publicKey?.trim()) && input.consent === "granted";
}

export function sanitizedPageLocation(origin: string, pathname: string): string {
  const parsedOrigin = new URL(origin).origin;
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${parsedOrigin}${path.split(/[?#]/, 1)[0] || "/"}`;
}
