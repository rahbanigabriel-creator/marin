import { expect, test, type Page, type Route } from "@playwright/test";

test.setTimeout(150_000);

const NOW = "2026-08-20T12:00:00.000Z";
const BRAND = {
  id: "brand_sprint9",
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
  timezone: "America/Los_Angeles",
  currency: "USD",
  contextVersion: 1,
  auditSnapshot: null,
  auditedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function point(date: string, spend: number, conversions: number) {
  return {
    date,
    metrics: {
      spend,
      revenue: null,
      conversions,
      clicks: 10,
      impressions: 100,
      roas: null,
      cpa: conversions > 0 ? spend / conversions : null,
      ctr: 10,
      cpc: spend / 10,
      cpm: spend * 10,
      cvr: conversions * 10,
      aov: null,
    },
  };
}

function dashboardPayload() {
  return {
    mode: "live",
    data: {
      range: { from: "2026-08-01", to: "2026-08-20", days: 20 },
      accounts: [
        {
          id: "source_us",
          accountId: "acct_us",
          accountName: "US Store",
          platform: "google_ads",
          platformLabel: "Google Ads",
          currency: "USD",
          timezone: "America/Los_Angeles",
          state: "available",
          requestedFrom: "2026-08-01T00:00:00.000Z",
          requestedTo: "2026-08-20T23:59:59.000Z",
          observedFrom: "2026-08-01",
          observedTo: "2026-08-20",
        },
        {
          id: "source_eu",
          accountId: "acct_eu",
          accountName: "EU Store",
          platform: "google_ads",
          platformLabel: "Google Ads",
          currency: "EUR",
          timezone: "Europe/Madrid",
          state: "partial",
          detail: "Revenue was not returned.",
          observedFrom: "2026-08-03",
          observedTo: "2026-08-18",
        },
        {
          id: "source_unknown",
          accountId: "acct_unknown",
          accountName: "Currency Pending",
          platform: "meta_ads",
          platformLabel: "Meta Ads",
          currency: null,
          timezone: "UTC",
          state: "partial",
          detail: "Currency was not returned.",
          observedFrom: "2026-08-06",
          observedTo: "2026-08-15",
        },
      ],
      currencies: ["EUR", "USD"],
      mixedCurrency: true,
      totals: {
        metrics: {
          spend: 1200,
          revenue: null,
          conversions: 0,
          clicks: 20,
          impressions: 200,
          roas: null,
          cpa: null,
          ctr: 10,
          cpc: null,
          cpm: null,
          cvr: 0,
          aov: null,
        },
      },
      previous: { metrics: {} },
      series: [point("2026-08-19", 600, 0), point("2026-08-20", 600, 0)],
      platforms: [
        {
          platform: "google_ads",
          label: "Google Ads",
          metrics: { spend: 1200, revenue: null, conversions: 0, clicks: 20, impressions: 200, roas: null },
        },
      ],
      campaigns: [
        {
          accountId: "acct_us",
          accountName: "US Store",
          externalId: "campaign_us_101",
          platform: "google_ads",
          label: "Google Ads",
          campaign: "Always On",
          currency: "USD",
          sourceState: "available",
          observedFrom: "2026-08-01",
          observedTo: "2026-08-20",
          status: "active",
          objective: "Sales",
          metrics: {
            spend: 1200,
            revenue: null,
            conversions: 0,
            clicks: 10,
            impressions: 100,
            roas: null,
            cpa: null,
            ctr: 10,
            cpc: 120,
            cpm: 12000,
            cvr: 0,
            aov: null,
          },
          series: [point("2026-08-19", 600, 0), point("2026-08-20", 600, 0)],
          ads: [
            {
              externalId: "ad_us_1",
              name: "Founder demo",
              status: "active",
              creativeType: "video",
              currency: "USD",
              metricsFrom: "2026-08-05",
              metricsTo: "2026-08-17",
              metrics: { spend: 400, impressions: 60, clicks: 8, conversions: 0, ctr: 13.33 },
            },
          ],
        },
        {
          accountId: "acct_eu",
          accountName: "EU Store",
          externalId: "campaign_eu_202",
          platform: "google_ads",
          label: "Google Ads",
          campaign: "Always On",
          currency: "EUR",
          sourceState: "partial",
          observedFrom: "2026-08-03",
          observedTo: "2026-08-18",
          status: "paused",
          objective: "Leads",
          metrics: {
            spend: 0,
            revenue: 0,
            conversions: 0,
            clicks: 10,
            impressions: 100,
            roas: null,
            cpa: null,
            ctr: 10,
            cpc: 0,
            cpm: 0,
            cvr: 0,
            aov: null,
          },
          series: [point("2026-08-19", 0, 0), point("2026-08-20", 0, 0)],
          ads: [],
        },
        {
          accountId: "acct_unknown",
          accountName: "Currency Pending",
          externalId: "campaign_unknown_303",
          platform: "meta_ads",
          label: "Meta Ads",
          campaign: "Currency Check",
          currency: null,
          sourceState: "partial",
          observedFrom: "2026-08-06",
          observedTo: "2026-08-15",
          status: "active",
          objective: "Traffic",
          metrics: {
            spend: null,
            revenue: null,
            conversions: null,
            clicks: 3,
            impressions: 30,
            roas: null,
          },
          series: [],
          ads: [],
        },
      ],
    },
  };
}

async function mockApp(page: Page, dashboard: unknown = dashboardPayload()): Promise<{ syncRequests: Array<{ body: unknown; contentType: string | undefined }> }> {
  const syncRequests: Array<{ body: unknown; contentType: string | undefined }> = [];
  await page.route(/\/api\/connections(?:\?.*)?$/, (route) => json(route, { workspace: { name: "Solo Founder" }, connections: [] }));
  await page.route(/\/api\/brands(?:\?.*)?$/, (route) => json(route, { brands: [BRAND] }));
  await page.route(/\/api\/conversations(?:\?.*)?$/, (route) => json(route, { conversations: [] }));
  await page.route(/\/api\/billing(?:\?.*)?$/, (route) => json(route, { billing: { canManage: true, entitlements: { canUseOpus: false }, resources: { connections: 2 } } }));
  await page.route(/\/api\/dashboard(?:\?.*)?$/, (route) => json(route, dashboard));
  await page.route(/\/api\/sync(?:\?.*)?$/, async (route) => {
    const request = route.request();
    syncRequests.push({ body: request.postDataJSON(), contentType: request.headers()["content-type"] });
    await json(route, {
      ok: true,
      status: "partial",
      results: [
        { accountId: "acct_us", accountName: "US Store", status: "success", metrics: 12 },
        { accountId: "acct_eu", accountName: "EU Store", status: "failed", error: "Token expired" },
      ],
    });
  });
  return { syncRequests };
}

async function expectContainedLayout(page: Page): Promise<void> {
  const pageBounds = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(pageBounds.documentWidth).toBeLessThanOrEqual(pageBounds.viewport);

  const kpiValues = page.getByTestId("kpi-value");
  await expect(kpiValues).toHaveCount(6);
  const kpiBounds = await kpiValues.evaluateAll((elements) => elements.map((element) => {
    const node = element as HTMLElement;
    const box = node.getBoundingClientRect();
    return {
      text: node.textContent,
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      left: box.left,
      right: box.right,
      visible: box.width > 0 && box.height > 0,
    };
  }));
  for (const value of kpiBounds) {
    expect(value.visible, JSON.stringify(value)).toBe(true);
    expect(value.scrollWidth, JSON.stringify(value)).toBeLessThanOrEqual(value.clientWidth);
    expect(value.left, JSON.stringify(value)).toBeGreaterThanOrEqual(0);
    expect(value.right, JSON.stringify(value)).toBeLessThanOrEqual(pageBounds.viewport + 1);
  }
  expect(kpiBounds.some((value) => value.text?.trim() === "Unavailable")).toBe(true);
}

test("keeps duplicate campaign names distinct and reports paid data truthfully", async ({ page }) => {
  const mock = await mockApp(page);
  await page.goto("/app?mode=paid&view=campaigns");

  await expect(page.getByRole("heading", { name: "Paid command center" })).toBeVisible();
  await expect(page.getByTestId("paid-overview")).toBeVisible();
  await expect(page.getByRole("group", { name: "Paid performance trend", exact: true })).toBeVisible();
  const mixedTrend = page.getByRole("group", { name: "Paid performance trend", exact: true });
  await mixedTrend.getByText("View chart data", { exact: true }).click();
  const displayedValues = await mixedTrend.getByRole("table").locator("tbody tr td:last-child").allTextContents();
  expect(displayedValues.length).toBeGreaterThan(0);
  expect(displayedValues.every((value) => value.trim() === "Unavailable")).toBe(true);
  await mixedTrend.getByText("View chart data", { exact: true }).click();
  await expect(page.getByRole("img", { name: "2 active, 1 paused, 0 other campaigns" })).toBeVisible();
  await expect(page.getByTestId("paid-creative-gallery").getByRole("article")).toHaveCount(3);
  await page.getByRole("button", { name: "Show paused campaigns" }).click();
  await expect(page.getByTestId("paid-creative-gallery").getByRole("article")).toHaveCount(1);
  await expect(page.getByTestId("paid-creative-gallery")).toContainText("EU Store");
  await page.getByRole("button", { name: "Clear campaign status filter" }).click();
  await page.getByRole("button", { name: "Open creative details for Always On in US Store" }).click();
  await expect(page.getByRole("dialog", { name: "Always On" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByTestId("campaign-table-scroll").getByText("Always On", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("row", { name: "Open Always On for US Store" })).toHaveCount(1);
  await expect(page.getByRole("row", { name: "Open Always On for EU Store" })).toHaveCount(1);
  await expect(page.getByRole("row", { name: "Open Currency Check for Currency Pending" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /US Store/ })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: /EU Store/ })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText(/Currency-safe totals unavailable \(EUR, USD \+ unknown currency\)/)).toBeVisible();
  await page.getByText("Data coverage", { exact: false }).first().click();
  await expect(page.getByText(/Requested Aug 1 – Aug 20 \(multiple source timezones\)/)).toBeVisible();
  await expect(page.getByText(/Observed Aug 1 – Aug 20 \(multiple source timezones\)/)).toBeVisible();
  await expectContainedLayout(page);


  const usRow = page.getByRole("row", { name: "Open Always On for US Store" });
  const euRow = page.getByRole("row", { name: "Open Always On for EU Store" });
  await expect(usRow).toContainText("$1,200");
  await expect(usRow.getByTitle("Revenue: Unavailable")).toBeVisible();
  await expect(euRow).toContainText("€0");
  await expect(euRow).toContainText("0");

  const spendHeader = page.getByRole("columnheader", { name: /Spend/ });
  await expect(spendHeader).toHaveAttribute("aria-sort", "descending");
  await spendHeader.getByRole("button").click();
  await expect(spendHeader).toHaveAttribute("aria-sort", "ascending");
  await expect(page.getByRole("searchbox", { name: "Search campaigns or accounts" })).toBeVisible();

  await page.getByRole("button", { name: /US Store/ }).click();
  await expect(page.getByRole("button", { name: /US Store/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Multiple currencies selected/)).toHaveCount(0);
  await expect(page.getByText("$1,200", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /All accounts/ }).click();

  await page.getByRole("button", { name: "Custom" }).click();
  const customRange = page.getByRole("group", { name: "Custom date range" });
  await customRange.getByLabel("From").fill("2026-08-10");
  await customRange.getByLabel("To").fill("2026-08-12");
  await customRange.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Sync now" }).first().click();
  await expect.poll(() => mock.syncRequests.length).toBe(1);
  expect(mock.syncRequests[0]).toEqual({
    body: { from: "2026-08-10", to: "2026-08-12" },
    contentType: "application/json",
  });
  await expect(page.getByRole("alert").filter({ hasText: "Sync finished with issues" })).toContainText("1 of 2 accounts failed (EU Store)");

  await usRow.focus();
  await expect(usRow).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Always On" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close campaign details" })).toBeFocused();
  await expect(dialog).toContainText("US Store");
  await expect(dialog).toContainText("Observed Aug 1 – Aug 20 (America/Los_Angeles)");
  await expect(dialog).toContainText("Ad metrics Aug 5 – Aug 17 (America/Los_Angeles)");
  await expect(dialog).not.toContainText("Ad metrics Aug 1 – Aug 20");
  await dialog.getByText("View chart data").click();
  await expect(dialog.getByRole("table")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(usRow).toBeFocused();
});

test("paid command center stays contained on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApp(page);
  await page.goto("/app?mode=paid&view=campaigns");

  await expect(page.getByRole("heading", { name: "Paid command center" })).toBeVisible();
  await expect(page.getByTestId("paid-overview")).toBeVisible();
  await expect(page.getByTestId("paid-creative-gallery")).toBeVisible();
  await expect(page.getByRole("group", { name: "Filter by ad account" }).getByRole("button", { name: /US Store/ })).toBeVisible();
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => ({ tag: element.tagName, text: element.innerText?.slice(0, 40), right: Math.round(element.getBoundingClientRect().right) }))
      .filter((item) => item.right > window.innerWidth + 1)
      .slice(0, 8),
  }));
  expect(layout.scrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
  await expectContainedLayout(page);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const tableScroll = await page.getByTestId("campaign-table-scroll").evaluate((element) => {
    const node = element as HTMLElement;
    const box = node.getBoundingClientRect();
    return { clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, left: box.left, right: box.right };
  });
  expect(tableScroll.scrollWidth).toBeLessThanOrEqual(tableScroll.clientWidth + 1);
  expect(tableScroll.left).toBeGreaterThanOrEqual(0);
  expect(tableScroll.right).toBeLessThanOrEqual(391);

  const row = page.getByRole("row", { name: "Open Always On for EU Store" });
  await row.scrollIntoViewIfNeeded();
  await row.click();
  const dialog = page.getByRole("dialog", { name: "Always On" });
  const box = await dialog.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  await expect(dialog.getByRole("button", { name: "Close campaign details" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
});

test("sync route enforces the exact bounded JSON date-range contract", async ({ request }) => {
  const headers = { "Content-Type": "application/json" };
  const valid = await request.post("/api/sync", {
    headers,
    data: { from: "2024-01-01", to: "2024-12-31" },
  });
  expect(valid.status()).toBe(503);
  await expect(valid.json()).resolves.toMatchObject({ error: "persistence_unavailable" });

  const invalidBodies = [
    { from: "2026-08-12", to: "2026-08-10" },
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2024-01-01", to: "2025-01-01" },
    { from: "2026-08-10", to: "2026-08-12", days: 3 },
  ];
  for (const data of invalidBodies) {
    const response = await request.post("/api/sync", { headers, data });
    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_sync_request" });
  }
  const missingContentType = await request.post("/api/sync", {
    data: "{\"from\":\"2026-08-10\",\"to\":\"2026-08-12\"}",
  });
  expect(missingContentType.status()).toBe(400);
});

test("visual workspace preserves sparse data, exact small spend, and source creative failures", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const payload = dashboardPayload();
  const campaign = payload.data.campaigns[0];
  const nullableMetrics = { spend: null, revenue: null, conversions: null, clicks: null, impressions: null, roas: null, cpa: null, ctr: null, cpc: null, cpm: null, cvr: null, aov: null };
  const series = Array.from({ length: 20 }, (_, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, "0")}`,
    metrics: index === 8 || index === 10
      ? { ...nullableMetrics, spend: index === 8 ? 7.25 : 2.99, clicks: 168, impressions: 750, ctr: 22.4 }
      : nullableMetrics,
  }));
  const metrics = { ...nullableMetrics, spend: 10.24, clicks: 336, impressions: 1500, ctr: 22.4 };
  const fixture = {
    mode: "live",
    data: {
      ...payload.data,
      accounts: [{ ...payload.data.accounts[0], currency: "EUR", platform: "meta_ads", platformLabel: "Meta Ads", accountName: "Fixture account", timezone: "Europe/Madrid", state: "partial", observedFrom: "2026-08-09", observedTo: "2026-08-11" }],
      currencies: ["EUR"], mixedCurrency: false,
      totals: { metrics }, series,
      platforms: [{ platform: "meta_ads", label: "Meta Ads", currency: "EUR", metrics }],
      campaigns: Array.from({ length: 3 }, (_, index) => ({
        ...campaign, externalId: `fixture_${index}`, currency: "EUR", platform: "meta_ads", label: "Meta Ads", accountName: "Fixture account",
        campaign: ["Founder story", "Product walkthrough", "Customer perspective"][index],
        status: "paused", metrics: { ...metrics, spend: index === 0 ? 10.24 : 0 }, series,
        ads: [{ ...campaign.ads[0], thumbnailUrl: index === 1 ? "/missing-fixture-preview.png" : "/marpin-logo.png", title: "Fixture creative", body: "Source-supplied creative preview", metricsFrom: "2026-08-09", metricsTo: "2026-08-11" }],
      })),
    },
  };
  fixture.data.campaigns[0].ads.push({ ...fixture.data.campaigns[0].ads[0], externalId: "fixture-second", title: "Second creative" });
  await mockApp(page, fixture);
  await page.goto("/app?mode=paid&view=campaigns");
  await expect(page.getByRole("button", { name: "Chart Ad spend" })).toContainText("€10.24");
  await page.getByRole("group", { name: "Filter by ad account" }).getByRole("button", { name: /Fixture account/ }).click();
  await expect(page.getByRole("button", { name: "Chart Ad spend" })).toContainText("€10.24");
  const selector = page.getByRole("combobox", { name: "Preview creative for Founder story in Fixture account" });
  await selector.selectOption("fixture-second");
  fixture.data.campaigns[0].ads.reverse();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(selector).toHaveValue("fixture-second");
  fixture.data.campaigns[0].ads.shift();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(selector).toHaveCount(0);
  await expect(page.getByTestId("paid-creative-gallery").getByRole("article").first().getByRole("img", { name: "Fixture creative" })).toBeVisible();
  await expect(page.getByRole("img", { name: "0 active, 3 paused, 0 other campaigns" })).toBeVisible();
  await expect(page.getByTestId("paid-creative-gallery").getByText("Preview unavailable", { exact: true })).toHaveCount(1);
  const preview = page.getByTestId("paid-creative-gallery").getByRole("img", { name: "Fixture creative" }).first();
  await expect.poll(() => preview.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Reported days", exact: true }).click();
  const trend = page.getByRole("group", { name: "Paid performance trend", exact: true });
  await trend.getByText("View chart data", { exact: true }).click();
  await expect(trend.getByRole("table").getByRole("row")).toHaveCount(4);
  await expect(trend.getByRole("row").filter({ hasText: "Aug 10" })).toContainText("Unavailable");
  await trend.getByText("View chart data", { exact: true }).click();
  await page.getByRole("button", { name: "Bar chart", exact: true }).click();
  await expect(page.getByRole("button", { name: "Bar chart", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expectContainedLayout(page);
  await page.screenshot({ path: testInfo.outputPath("paid-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Chart Conversions", exact: true }).click();
  await expect(trend).toContainText("is unavailable for this source.");
  await page.getByRole("button", { name: "Chart Ad spend", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectContainedLayout(page);
  await page.screenshot({ path: testInfo.outputPath("paid-mobile.png"), fullPage: true });
  await trend.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("paid-mobile-chart.png") });
  await page.getByTestId("paid-creative-gallery").getByRole("article").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("paid-mobile-creative.png") });
});
