import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { parseAnalyticsRange } from "../src/lib/distribution-analytics/validation";
import { buildMeasurementAnalytics } from "../src/lib/measurement-analytics/service";
import { connection, fact, now, paidConnection, paidFact, range } from "../src/lib/measurement-analytics/__tests__/fixtures";

const endpoint = /\/api\/measurement-analytics(?:\?.*)?$/;
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

function result(requested = range) {
  return buildMeasurementAnalytics({ workspaceId: "workspace-1", range: requested, now, snapshot: {
    connections: [connection(), paidConnection(), paidConnection({ id: "meta-1", platform: "meta_ads", currency: "USD", displayName: "Meta account" })],
    facts: [fact(), fact({ id: "unassigned", campaign: "", metric: "conversions", value: 0 }),
      paidFact({ metric: "spend", value: 42 }), paidFact({ id: "clicks", value: 120 }),
      paidFact({ id: "zero", date: range.to, value: 0 }),
      paidFact({ id: "meta-spend", connectionId: "meta-1", platform: "meta_ads", metric: "spend", value: 27, currency: "USD" })],
  } });
}

async function setup(page: Page) {
  await page.route(/\/api\/connections(?:\?.*)?$/, (route) => json(route, { workspace: { name: "Analytics QA" }, connections: [] }));
  await page.route(/\/api\/brands(?:\?.*)?$/, (route) => json(route, { brands: [] }));
  await page.route(/\/api\/conversations(?:\?.*)?$/, (route) => json(route, { conversations: [] }));
  await page.route(/\/api\/billing(?:\?.*)?$/, (route) => json(route, { billing: { canManage: true, plan: { name: "Solo" }, entitlements: { canUseOpus: false, maxConnections: 10 }, resources: { connections: 0 } } }));
  await page.route(endpoint, (route) => json(route, result()));
}

test("legacy GA4 observations and paid charts stay truthful on desktop and mobile", async ({ page }, info) => {
  await setup(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app?mode=analytics");
  const screen = page.getByRole("region", { name: "Analytics", exact: true });
  await expect(screen.getByRole("heading", { name: "Google Analytics 4" })).toBeVisible();
  await expect(screen.getByText("Property totals unavailable for these records.", { exact: true })).toBeVisible();
  await expect(screen.getByText("Property not recorded", { exact: true })).toHaveCount(2);
  await expect(screen.getByText(/Revenue and ROAS are unavailable/)).toBeHidden();
  const ga4 = screen.getByRole("region", { name: "Google Analytics 4", exact: true });
  const conversionRow = ga4.getByRole("row").filter({ hasText: "Conversions" });
  await expect(conversionRow.getByRole("cell", { name: "Unknown", exact: true })).toBeVisible();
  await expect(conversionRow.getByRole("cell", { name: "0", exact: true })).toHaveCount(0);
  await ga4.getByText("Source coverage", { exact: true }).click();
  await expect(screen.getByText(/Revenue and ROAS are unavailable/)).toBeVisible();
  await ga4.getByText("Source coverage", { exact: true }).click();
  await expect(screen.getByRole("heading", { name: /SEO|Organic workflow/ })).toHaveCount(0);
  await expect(screen.getByText(/EUR\s*42\.00/)).toBeVisible();
  await expect(screen.getByRole("figure", { name: "Daily paid clicks" })).toBeVisible();
  await expect(screen.locator('[title="2026-09-02: No observation"]')).toBeAttached();
  await screen.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Manage connections" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: info.outputPath("measurement-desktop.png"), fullPage: true, animations: "disabled" });
  const accessibility = await new AxeBuilder({ page }).include('[aria-labelledby="measurement-analytics-title"]').analyze();
  expect(accessibility.violations).toEqual([]);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(async () => (await page.locator("aside").filter({ has: page.getByRole("img", { name: "Marpin", exact: true }) }).boundingBox())?.width).toBe(64);
    await expect(screen.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: info.outputPath(`measurement-mobile-${width}.png`), fullPage: true, animations: "disabled" });
  }
});

test("paid accounts retain their own currencies and never share charts", async ({ page }) => {
  await setup(page);
  await page.goto("/app?mode=analytics");
  await page.getByRole("combobox", { name: "Paid measurement account" }).selectOption("meta-1");
  await expect(page.getByText(/USD\s*27\.00/)).toBeVisible();
  await expect(page.getByText(/EUR\s*42\.00/)).toHaveCount(0);
  await expect(page.getByRole("figure", { name: "Daily paid clicks" })).toHaveCount(0);
});

test("date validation, successful empty range, and failed refresh keep results honest", async ({ page }) => {
  await setup(page);
  let fail = false;
  await page.route(endpoint, (route) => {
    if (fail) return json(route, { message: "Analytics is temporarily unavailable." }, 503);
    const query = new URL(route.request().url()).searchParams;
    return json(route, result(query.size ? parseAnalyticsRange(query) : range));
  });
  await page.goto("/app?mode=analytics");
  await page.getByLabel("From", { exact: true }).fill("2026-09-04");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("region", { name: "Analytics", exact: true }).getByRole("alert")).toContainText("from must not be after to");
  await page.getByLabel("To", { exact: true }).fill("2026-09-05");
  fail = true;
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("region", { name: "Analytics", exact: true }).getByRole("alert")).toContainText("previous result and its date range remain displayed");
  await expect(page.getByText(/Showing 2026-09-01 to 2026-09-03/)).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText(/Showing 2026-09-04 to 2026-09-05/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "No GA4 measurements in this range" })).toBeVisible();
  await expect(page.getByRole("figure", { name: "Daily paid clicks" })).toHaveCount(0);
});

test("access loss clears previously displayed measurements", async ({ page }) => {
  await setup(page);
  await page.goto("/app?mode=analytics");
  await expect(page.getByText(/EUR\s*42\.00/)).toBeVisible();
  await page.route(endpoint, (route) => json(route, { error: "forbidden" }, 403));
  await page.getByRole("button", { name: "Refresh analytics" }).click();
  await expect(page.getByRole("heading", { name: "Analytics unavailable" })).toBeVisible();
  await expect(page.getByText(/EUR\s*42\.00/)).toHaveCount(0);
  await expect(page.getByRole("table", { name: "GA4 stored observations" })).toHaveCount(0);
});

test("mobile empty workspace has explicit GA4, paid and AppsFlyer no-data states", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.route(endpoint, (route) => json(route, buildMeasurementAnalytics({ workspaceId: "workspace-1", range, now, snapshot: { connections: [], facts: [] } })));
  await page.goto("/app?mode=analytics");
  await expect(page.getByText("GA4 is not connected.", { exact: true })).toBeVisible();
  await expect(page.getByText("No paid measurement sources connected.", { exact: true })).toBeVisible();
  await expect(page.getByText("Unavailable. No connector or measurements configured.", { exact: true })).toBeVisible();
  await expect(page.getByRole("figure")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: info.outputPath("measurement-empty-mobile.png"), fullPage: true, animations: "disabled" });
});
