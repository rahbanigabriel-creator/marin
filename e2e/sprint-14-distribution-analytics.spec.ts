import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

import type { DistributionAnalyticsResponse } from "../src/lib/distribution-analytics/types";

test.setTimeout(120_000);

const NOW = "2026-08-21T12:00:00.000Z";
const BRAND = {
  id: "brand_analytics",
  name: "Marpin",
  websiteUrl: "https://www.marpin.ai",
  isPrimary: true,
  summary: "Distribution software for solo founders",
  audience: ["Solo founders"],
  voice: ["Direct"],
  offers: ["Marketing operating system"],
  competitors: [],
  proofPoints: [],
  visualStyle: [],
  locale: "en-US",
  timezone: "Europe/Madrid",
  currency: "EUR",
  contextVersion: 1,
  auditSnapshot: null,
  auditedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

const metrics = {
  spend: 420,
  revenue: 1_260,
  roas: 3,
  cpa: 21,
  conversions: 20,
  clicks: 800,
  impressions: 24_000,
  ctr: 3.33,
  cpc: 0.525,
  cpm: 17.5,
  cvr: 2.5,
  aov: 63,
};

const analytics: DistributionAnalyticsResponse = {
  schemaVersion: "2026-08-22",
  generatedAt: NOW,
  state: "partial",
  range: { from: "2026-07-23", to: "2026-08-21", days: 30, timezone: "UTC" },
  organic: {
    state: "available",
    outputType: "operational",
    totalPublications: 5,
    userConfirmedExternalHandoffs: 2,
    byState: [{ key: "scheduled", count: 3 }, { key: "published", count: 2 }],
    byPlatform: [{ key: "instagram", count: 3 }, { key: "reddit", count: 2 }],
    timeline: [
      { date: "2026-08-20", scheduled: 2, userConfirmedExternalHandoffs: 1 },
      { date: "2026-08-21", scheduled: 1, userConfirmedExternalHandoffs: 1 },
    ],
    coverage: { observedFrom: "2026-08-20", observedTo: "2026-08-21", freshnessAt: NOW },
    performance: {
      state: "unavailable",
      reason: "organic_provider_reads_not_connected",
      message: "No organic provider metrics are connected. Calendar and handoff records do not establish reach, impressions, engagements, or clicks.",
      source: null,
      coverage: { observedFrom: null, observedTo: null, freshnessAt: null },
      reach: null,
      impressions: null,
      engagements: null,
      clicks: null,
    },
  },
  seo: {
    state: "available",
    outputType: "operational",
    totalTasks: 4,
    byStatus: [{ key: "open", count: 2 }, { key: "in_progress", count: 1 }, { key: "completed", count: 1 }],
    bySeverity: [{ key: "critical", count: 1 }, { key: "high", count: 2 }],
    byPriority: [{ key: "p1_25", count: 3 }, { key: "p26_50", count: 1 }],
    coverage: {
      observedFrom: "2026-08-01",
      observedTo: "2026-08-21",
      freshnessAt: NOW,
      latestAnalyzedAt: NOW,
      latestUpdatedAt: NOW,
    },
  },
  paid: {
    state: "available",
    outputType: "measured_outcome",
    totals: metrics,
    platforms: [{ platform: "google_ads", label: "Google Ads", currency: "EUR", mixedCurrency: false, metrics }],
    currency: "EUR",
    currencies: ["EUR"],
    mixedCurrency: false,
    requestedRange: { from: "2026-07-23", to: "2026-08-21" },
    observedRange: { from: "2026-08-01", to: "2026-08-21" },
    sourceCount: 1,
    sourcesTruncated: false,
  },
  sources: [
    {
      id: "organic_calendar",
      name: "Organic calendar",
      kind: "operational",
      state: "available",
      detail: "5 persisted publications",
      freshnessAt: NOW,
      observedFrom: "2026-08-20",
      observedTo: "2026-08-21",
    },
    {
      id: "organic_provider_performance",
      name: "Organic provider performance",
      kind: "measured_outcome",
      state: "unavailable",
      detail: "Provider reads are not connected.",
      freshnessAt: null,
      observedFrom: null,
      observedTo: null,
    },
  ],
  sourcesTruncated: false,
};

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockApp(page: Page): Promise<void> {
  await page.route(/\/api\/connections(?:\?.*)?$/, (route) =>
    json(route, { workspace: { name: "Solo Founder" }, connections: [] }),
  );
  await page.route(/\/api\/brands(?:\?.*)?$/, (route) => json(route, { brands: [BRAND] }));
  await page.route(/\/api\/conversations(?:\?.*)?$/, (route) => json(route, { conversations: [] }));
  await page.route(/\/api\/billing(?:\?.*)?$/, (route) =>
    json(route, {
      billing: {
        canManage: true,
        entitlements: { canUseOpus: false },
        resources: { connections: 0 },
      },
    }),
  );
  await page.route(/\/api\/analytics(?:\?.*)?$/, (route) => json(route, analytics));
}

test("analytics is a truthful, restorable workspace on desktop and mobile", async ({ page }) => {
  await mockApp(page);
  await page.goto("/app?mode=analytics");

  await expect(page.getByRole("heading", { name: "Distribution analytics" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Analytics", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("No organic provider metrics are connected. Calendar and handoff records do not establish reach, impressions, engagements, or clicks.")).toBeVisible();
  await expect(page.getByText("€420.00", { exact: true })).toBeVisible();
  await expect(page.getByText("€1,260.00", { exact: true })).toBeVisible();
  await expect(page.getByText("3×", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await expect(page).toHaveURL(/mode=assistant/);
  await page.goBack();
  await expect(page).toHaveURL(/mode=analytics/);
  await expect(page.getByRole("heading", { name: "Distribution analytics" })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Distribution analytics" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("analytics failure state offers an explicit retry", async ({ page }) => {
  await mockApp(page);
  await page.unroute(/\/api\/analytics(?:\?.*)?$/);
  await page.route(/\/api\/analytics(?:\?.*)?$/, (route) =>
    json(route, { error: "persistence_unavailable", message: "Analytics is temporarily unavailable." }, 503),
  );

  await page.goto("/app?mode=analytics");
  await expect(page.getByRole("heading", { name: "Analytics unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText("Analytics is temporarily unavailable.", { exact: true })).toHaveAttribute("role", "alert");
});
