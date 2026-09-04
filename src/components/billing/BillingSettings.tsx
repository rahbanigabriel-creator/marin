"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuArrowLeft,
  LuArrowRight,
  LuBadgeCheck,
  LuCalendarDays,
  LuCheck,
  LuCircleAlert,
  LuCreditCard,
  LuHardDrive,
  LuPlug,
  LuRefreshCw,
  LuSparkles,
  LuUsers,
} from "react-icons/lu";

import type { BillingInterval } from "@/lib/billing/plans";
import type { BillingSnapshotDto } from "@/lib/billing/types";

type LoadState = "loading" | "ready" | "error";
type BillingAction = "checkout" | "portal" | null;
type CheckoutReturn = "success" | "cancelled" | null;

interface ApiErrorPayload {
  error?: string;
  detail?: string;
  message?: string;
  checkoutUrl?: string;
  url?: string;
}

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";

const planFeatures = {
  free: [
    "25 Marpin credits each month",
    "1 connected platform",
    "10 scheduled posts",
    "Auto and High model routing",
  ],
  solo: [
    "120 Marpin credits each month",
    "Google Ads and Meta Ads connections",
    "100 scheduled posts",
    "Paid monitoring, campaign drafts, and assisted publishing",
  ],
} as const;

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function readableStatus(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatBytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function apiErrorMessage(status: number, payload: ApiErrorPayload): string {
  switch (payload.error) {
    case "not_configured":
      return "Billing is not configured yet. Your current plan remains available.";
    case "price_not_configured":
      return "That billing interval is not available yet.";
    case "no_subscription":
      return "There is no active subscription to manage yet.";
    case "subscription_exists":
      return payload.message || "This workspace already has a subscription to manage.";
    case "checkout_in_progress":
      return payload.message || "A subscription checkout is already open for this workspace.";
    case "forbidden":
      return "Only a workspace owner or admin can manage billing.";
    case "checkout_failed":
      return "Stripe checkout could not be opened. Please try again.";
    case "portal_failed":
      return "The billing portal could not be opened. Please try again.";
    default:
      return payload.detail || `Billing request failed (${status}). Please try again.`;
  }
}

async function readError(response: Response): Promise<string> {
  try {
    return apiErrorMessage(response.status, (await response.json()) as ApiErrorPayload);
  } catch {
    return `Billing request failed (${response.status}). Please try again.`;
  }
}

function UsageMeter({ billing }: { billing: BillingSnapshotDto }) {
  const used = billing.usage.committed + billing.usage.reserved;
  const percentage = billing.usage.included
    ? Math.min(100, Math.round((used / billing.usage.included) * 100))
    : 0;
  const periodEnd = formatDate(billing.usage.periodEnd);

  return (
    <section aria-labelledby="credit-usage-title" className="border-b border-line-2 py-[26px]">
      <div className="flex flex-wrap items-end justify-between gap-[10px]">
        <div>
          <p className="m-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">
            Current usage
          </p>
          <h2 id="credit-usage-title" className="mb-0 mt-[5px] font-sans text-[19px] font-semibold text-ink-900">
            Marpin credits
          </h2>
        </div>
        <p className="m-0 font-mono text-[12px] text-ink-400">
          {used} of {billing.usage.included} used
        </p>
      </div>

      <div
        className="mt-[16px] h-[10px] w-full overflow-hidden rounded-[5px] bg-track-1"
        role="progressbar"
        aria-label="Monthly Marpin credit usage"
        aria-valuemin={0}
        aria-valuemax={billing.usage.included}
        aria-valuenow={Math.min(used, billing.usage.included)}
        aria-valuetext={`${used} of ${billing.usage.included} credits used`}
      >
        <div
          className="h-full rounded-[5px] bg-plum transition-[width] duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="mt-[10px] flex flex-wrap items-center justify-between gap-x-[20px] gap-y-[4px] font-sans text-[12.5px] text-ink-400">
        <span>
          {billing.usage.remaining} remaining
          {billing.usage.reserved > 0 ? ` · ${billing.usage.reserved} in progress` : ""}
        </span>
        {periodEnd ? <span>Resets {periodEnd}</span> : null}
      </div>
    </section>
  );
}

function ResourceUsage({ billing }: { billing: BillingSnapshotDto }) {
  const resources = [
    {
      label: "Connections",
      valueText: `${billing.resources.connections} of ${billing.entitlements.maxConnections} used`,
      icon: LuPlug,
    },
    {
      label: "Seats",
      valueText: `${billing.resources.seats} of ${billing.entitlements.maxSeats} used`,
      icon: LuUsers,
    },
    {
      label: "Calendar",
      valueText: `${billing.resources.scheduledPosts} of ${billing.entitlements.maxScheduledPosts} used`,
      icon: LuCalendarDays,
    },
    {
      label: "Storage",
      valueText: `${formatBytes(billing.resources.storageUsedBytes)} of ${formatBytes(billing.entitlements.storageBytes)} used`,
      icon: LuHardDrive,
    },
  ];

  return (
    <section aria-labelledby="resource-usage-title" className="border-b border-line-2 py-[26px]">
      <p className="m-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">
        Workspace limits
      </p>
      <h2 id="resource-usage-title" className="mb-[15px] mt-[5px] font-sans text-[19px] font-semibold text-ink-900">
        Resources
      </h2>
      <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
        {resources.map(({ label, valueText, icon: Icon }) => (
          <div
            key={label}
            className="flex min-w-0 items-center gap-[12px] rounded-[8px] border border-line-3 bg-surface-card p-[14px]"
          >
            <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[7px] bg-track-1 text-ink-500">
              <Icon aria-hidden className="h-[17px] w-[17px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-sans text-[13px] font-semibold text-ink-900">{label}</span>
              <span className="block font-sans text-[12px] text-ink-400">
                {valueText}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PlanFeatureList({ features }: { features: readonly string[] }) {
  return (
    <ul className="m-0 grid list-none gap-[9px] p-0">
      {features.map((feature) => (
        <li key={feature} className="flex items-start gap-[8px] font-sans text-[13px] leading-[1.4] text-ink-600">
          <LuCheck aria-hidden className="mt-[2px] h-[14px] w-[14px] flex-none text-pos-700" />
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}

function LoadingState() {
  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-[1080px] px-[20px] py-[28px] sm:px-[32px]" aria-busy="true">
      <div className="h-[18px] w-[92px] animate-pulse rounded-[4px] bg-track-base" />
      <div className="mt-[34px] h-[32px] w-[220px] animate-pulse rounded-[5px] bg-track-base" />
      <div className="mt-[10px] h-[16px] w-full max-w-[440px] animate-pulse rounded-[4px] bg-track-1" />
      <div className="mt-[38px] h-[180px] animate-pulse rounded-[8px] border border-line-2 bg-surface-card" />
      <p className="mt-[16px] font-sans text-[13px] text-ink-400" role="status">
        Loading billing settings…
      </p>
    </main>
  );
}

export function BillingSettings() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [billing, setBilling] = useState<BillingSnapshotDto | null>(null);
  const [interval, setInterval] = useState<BillingInterval>("annual");
  const [action, setAction] = useState<BillingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutReturn, setCheckoutReturn] = useState<CheckoutReturn>(null);

  const loadBilling = useCallback(async (quiet = false) => {
    if (!quiet) setLoadState("loading");
    try {
      const response = await fetch("/api/billing", { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as { billing?: BillingSnapshotDto };
      if (!payload.billing) throw new Error("Billing information was not returned. Please try again.");
      setBilling(payload.billing);
      setLoadState("ready");
      setError(null);
    } catch (loadError) {
      if (!quiet) {
        setLoadState("error");
        setError(loadError instanceof Error ? loadError.message : "Billing settings could not be loaded.");
      }
    }
  }, []);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("checkout");
    setCheckoutReturn(value === "success" || value === "cancelled" ? value : null);
    void loadBilling();
  }, [loadBilling]);

  useEffect(() => {
    if (checkoutReturn !== "success" || billing?.plan.id === "solo") return;
    let attempts = 0;
    const poll = window.setInterval(() => {
      attempts += 1;
      void loadBilling(true);
      if (attempts >= 10) window.clearInterval(poll);
    }, 2500);
    return () => window.clearInterval(poll);
  }, [billing?.plan.id, checkoutReturn, loadBilling]);

  const intervalConfigured = useMemo(() => {
    if (!billing) return false;
    return interval === "annual"
      ? billing.checkout.annualConfigured
      : billing.checkout.monthlyConfigured;
  }, [billing, interval]);

  const openBillingUrl = useCallback(
    async (kind: Exclude<BillingAction, null>) => {
      if (!billing || action) return;
      setAction(kind);
      setError(null);
      try {
        const response = await fetch(
          kind === "checkout" ? "/api/billing/checkout" : "/api/billing/portal",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: kind === "checkout" ? JSON.stringify({ plan: "solo", interval }) : undefined,
          },
        );
        const payload = (await response.json()) as ApiErrorPayload;
        if (!response.ok) {
          if (kind === "checkout" && payload.error === "checkout_in_progress" && payload.checkoutUrl) {
            window.location.assign(payload.checkoutUrl);
            return;
          }
          throw new Error(apiErrorMessage(response.status, payload));
        }
        if (!payload.url) throw new Error("The secure billing page could not be opened.");
        window.location.assign(payload.url);
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "Billing could not be opened.");
        setAction(null);
      }
    },
    [action, billing, interval],
  );

  if (loadState === "loading") return <LoadingState />;

  if (loadState === "error" || !billing) {
    return (
      <main className="min-h-[100dvh] bg-surface-page px-[20px] py-[28px] sm:px-[32px]">
        <div className="mx-auto w-full max-w-[760px]">
          <Link
            href="/app"
            className={`${focusRing} inline-flex items-center gap-[7px] rounded-[5px] font-sans text-[13px] font-semibold text-ink-600 no-underline hover:text-ink-900`}
          >
            <LuArrowLeft aria-hidden /> Back to Marpin
          </Link>
          <section className="mt-[42px] border-y border-line-2 py-[28px]">
            <LuCircleAlert aria-hidden className="h-[22px] w-[22px] text-neg-700" />
            <h1 className="mb-0 mt-[12px] font-sans text-[24px] font-semibold text-ink-900">
              Billing settings are unavailable
            </h1>
            <p className="mb-0 mt-[8px] max-w-[560px] break-words font-sans text-[14px] leading-[1.55] text-ink-400">
              {error || "Marpin could not load this workspace’s billing information."}
            </p>
            <button
              type="button"
              onClick={() => void loadBilling()}
              className={`${focusRing} mt-[18px] inline-flex cursor-pointer items-center gap-[7px] rounded-[7px] border border-line-1 bg-surface-card px-[14px] py-[9px] font-sans text-[13px] font-semibold text-ink-800`}
            >
              <LuRefreshCw aria-hidden /> Try again
            </button>
          </section>
        </div>
      </main>
    );
  }

  const isSolo = billing.plan.id === "solo";
  const hasManagedSubscription = Boolean(
    billing.subscription &&
      !["inactive", "canceled", "incomplete_expired"].includes(
        billing.subscription.status.toLowerCase(),
      ),
  );
  const subscriptionStatus = billing.subscription?.status
    ? readableStatus(billing.subscription.status)
    : "Active";
  const periodEnd = formatDate(billing.subscription?.currentPeriodEnd ?? null);
  const upgradeDisabled =
    !billing.canManage || !billing.billingConfigured || !intervalConfigured || action !== null;
  const manageDisabled = !billing.canManage || !billing.billingConfigured || action !== null;
  const checkoutPending = checkoutReturn === "success" && !isSolo;

  return (
    <main className="min-h-[100dvh] overflow-x-hidden bg-surface-page text-ink-900">
      <div className="mx-auto w-full max-w-[1080px] px-[20px] py-[24px] sm:px-[32px] sm:py-[30px]">
        <Link
          href="/app"
          className={`${focusRing} inline-flex items-center gap-[7px] rounded-[5px] font-sans text-[13px] font-semibold text-ink-600 no-underline hover:text-ink-900`}
        >
          <LuArrowLeft aria-hidden /> Back to Marpin
        </Link>

        <header className="flex flex-wrap items-end justify-between gap-[18px] border-b border-line-2 pb-[24px] pt-[28px]">
          <div className="min-w-0">
            <p className="m-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">
              Workspace settings
            </p>
            <h1 className="mb-0 mt-[5px] font-sans text-[28px] font-semibold text-ink-900">
              Billing and usage
            </h1>
            <p className="mb-0 mt-[7px] max-w-[560px] font-sans text-[14px] leading-[1.5] text-ink-400">
              Review your plan, monthly credits, and workspace limits.
            </p>
          </div>
          <div className="flex items-center gap-[9px] rounded-[7px] border border-line-2 bg-surface-card px-[11px] py-[8px]">
            <span className="h-[7px] w-[7px] rounded-full bg-pos-500" aria-hidden />
            <span className="font-sans text-[12.5px] font-semibold text-ink-700">
              {billing.plan.name} · {subscriptionStatus}
            </span>
          </div>
        </header>

        <div aria-live="polite">
          {checkoutPending ? (
            <div className="mt-[18px] flex items-start gap-[10px] rounded-[7px] border border-plum-border bg-plum-soft px-[13px] py-[11px] text-plum-deep">
              <LuRefreshCw aria-hidden className="mt-[2px] h-[15px] w-[15px] flex-none animate-spin" />
              <p className="m-0 font-sans text-[13px] leading-[1.45]">
                Checkout completed. Stripe is confirming your subscription; this page will update automatically.
              </p>
            </div>
          ) : checkoutReturn === "success" && isSolo ? (
            <div className="mt-[18px] flex items-start gap-[10px] rounded-[7px] border border-line-2 bg-pos-bg px-[13px] py-[11px] text-pos-700">
              <LuBadgeCheck aria-hidden className="mt-[1px] h-[16px] w-[16px] flex-none" />
              <p className="m-0 font-sans text-[13px] leading-[1.45]">
                Solo Founder is active. Your updated credits and limits are shown below.
              </p>
            </div>
          ) : checkoutReturn === "cancelled" ? (
            <div className="mt-[18px] flex items-start gap-[10px] rounded-[7px] border border-line-2 bg-surface-card px-[13px] py-[11px] text-ink-600">
              <LuCircleAlert aria-hidden className="mt-[1px] h-[16px] w-[16px] flex-none" />
              <p className="m-0 font-sans text-[13px] leading-[1.45]">
                Checkout was cancelled. No plan change was made.
              </p>
            </div>
          ) : null}

          {billing.subscription?.cancelAtPeriodEnd ? (
            <div className="mt-[18px] flex items-start gap-[10px] rounded-[7px] border border-[#E9D7A8] bg-[#FBF6E8] px-[13px] py-[11px] text-ink-700">
              <LuCircleAlert aria-hidden className="mt-[1px] h-[16px] w-[16px] flex-none" />
              <p className="m-0 font-sans text-[13px] leading-[1.45]">
                Your subscription is set to cancel{periodEnd ? ` on ${periodEnd}` : " at the end of the current billing period"}. You can manage this in Stripe.
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-[18px] flex items-start gap-[10px] rounded-[7px] border border-[#ECCAD0] bg-neg-bg px-[13px] py-[11px] text-neg-700" role="alert">
              <LuCircleAlert aria-hidden className="mt-[1px] h-[16px] w-[16px] flex-none" />
              <p className="m-0 break-words font-sans text-[13px] leading-[1.45]">{error}</p>
            </div>
          ) : null}
        </div>

        <UsageMeter billing={billing} />
        <ResourceUsage billing={billing} />

        <section aria-labelledby="plans-title" className="py-[28px]">
          <div className="flex flex-wrap items-end justify-between gap-[14px]">
            <div>
              <p className="m-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">
                Plans
              </p>
              <h2 id="plans-title" className="mb-0 mt-[5px] font-sans text-[19px] font-semibold text-ink-900">
                Free and Solo Founder
              </h2>
            </div>

            <div
              className="grid w-full grid-cols-2 rounded-[8px] border border-line-seg bg-track-1 p-[3px] sm:w-auto"
              role="group"
              aria-label="Solo Founder billing interval"
            >
              <button
                type="button"
                aria-pressed={interval === "monthly"}
                onClick={() => setInterval("monthly")}
                className={`${focusRing} cursor-pointer rounded-[6px] border-none px-[13px] py-[7px] font-sans text-[12px] font-semibold transition-colors`}
                style={
                  interval === "monthly"
                    ? { background: "#FFFFFF", color: "#2B2722", boxShadow: "0 1px 2px rgba(43,39,34,.08)" }
                    : { background: "transparent", color: "#675F55" }
                }
              >
                Monthly
              </button>
              <button
                type="button"
                aria-pressed={interval === "annual"}
                onClick={() => setInterval("annual")}
                className={`${focusRing} cursor-pointer rounded-[6px] border-none px-[13px] py-[7px] font-sans text-[12px] font-semibold transition-colors`}
                style={
                  interval === "annual"
                    ? { background: "#FFFFFF", color: "#2B2722", boxShadow: "0 1px 2px rgba(43,39,34,.08)" }
                    : { background: "transparent", color: "#675F55" }
                }
              >
                Annual · recommended
              </button>
            </div>
          </div>

          <div className="mt-[18px] grid grid-cols-1 gap-[12px] md:grid-cols-2">
            <article
              className={`flex min-w-0 flex-col rounded-[8px] border bg-surface-card p-[18px] sm:p-[20px] ${
                !isSolo ? "border-plum" : "border-line-2"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-[8px]">
                <div>
                  <h3 className="m-0 font-sans text-[17px] font-semibold text-ink-900">Free</h3>
                  <p className="mb-0 mt-[4px] font-sans text-[12.5px] text-ink-400">For trying Marpin with one business</p>
                </div>
                {!isSolo ? (
                  <span className="rounded-[5px] bg-track-1 px-[8px] py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-600">
                    Current
                  </span>
                ) : null}
              </div>
              <div className="mb-[18px] mt-[20px] flex items-baseline gap-[5px]">
                <span className="font-sans text-[27px] font-semibold text-ink-900">€0</span>
                <span className="font-sans text-[12.5px] text-ink-400">forever</span>
              </div>
              <PlanFeatureList features={planFeatures.free} />
            </article>

            <article
              className={`flex min-w-0 flex-col rounded-[8px] border bg-surface-card p-[18px] sm:p-[20px] ${
                isSolo ? "border-plum" : "border-line-2"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-[8px]">
                <div>
                  <h3 className="m-0 flex items-center gap-[7px] font-sans text-[17px] font-semibold text-ink-900">
                    Solo Founder <LuSparkles aria-hidden className="h-[15px] w-[15px] text-plum" />
                  </h3>
                  <p className="mb-0 mt-[4px] font-sans text-[12.5px] text-ink-400">For running distribution every week</p>
                </div>
                {isSolo || hasManagedSubscription ? (
                  <span className="rounded-[5px] bg-plum-soft px-[8px] py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-plum-deep">
                    Current
                  </span>
                ) : null}
              </div>
              <div className="mb-[18px] mt-[20px] min-h-[42px]">
                {interval === "annual" ? (
                  <>
                    <span className="font-sans text-[27px] font-semibold text-ink-900">€399</span>
                    <span className="ml-[5px] font-sans text-[12.5px] text-ink-400">/ year</span>
                    <span className="block font-sans text-[11.5px] text-pos-700">€33.25/month · save €80.88</span>
                  </>
                ) : (
                  <>
                    <span className="font-sans text-[27px] font-semibold text-ink-900">€39.99</span>
                    <span className="ml-[5px] font-sans text-[12.5px] text-ink-400">/ month</span>
                  </>
                )}
              </div>
              <PlanFeatureList features={planFeatures.solo} />

              <div className="mt-auto pt-[22px]">
                {isSolo ? (
                  <button
                    type="button"
                    disabled={manageDisabled}
                    onClick={() => void openBillingUrl("portal")}
                    className={`${focusRing} flex min-h-[42px] w-full items-center justify-center gap-[8px] rounded-[7px] border border-line-1 bg-surface-chip px-[14px] py-[9px] font-sans text-[13px] font-semibold text-ink-800 enabled:cursor-pointer enabled:hover:bg-track-1 disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <LuCreditCard aria-hidden />
                    {action === "portal" ? "Opening Stripe…" : "Manage billing"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={upgradeDisabled}
                    onClick={() => void openBillingUrl("checkout")}
                    className={`${focusRing} flex min-h-[42px] w-full items-center justify-center gap-[8px] rounded-[7px] border-none bg-plum px-[14px] py-[9px] font-sans text-[13px] font-semibold text-white enabled:cursor-pointer enabled:hover:bg-plum-deep disabled:cursor-not-allowed disabled:bg-ink-200 disabled:opacity-50`}
                  >
                    {action === "checkout" ? "Opening checkout…" : "Upgrade to Solo"}
                    {action !== "checkout" ? <LuArrowRight aria-hidden /> : null}
                  </button>
                )}

                {!billing.canManage ? (
                  <p className="mb-0 mt-[8px] text-center font-sans text-[11.5px] text-ink-400">
                    Ask a workspace owner or admin to manage billing.
                  </p>
                ) : !billing.billingConfigured ? (
                  <p className="mb-0 mt-[8px] text-center font-sans text-[11.5px] text-ink-400">
                    Stripe checkout is not configured yet.
                  </p>
                ) : !isSolo && !intervalConfigured ? (
                  <p className="mb-0 mt-[8px] text-center font-sans text-[11.5px] text-ink-400">
                    {interval === "annual" ? "Annual" : "Monthly"} checkout is not available yet.
                  </p>
                ) : null}
              </div>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}
