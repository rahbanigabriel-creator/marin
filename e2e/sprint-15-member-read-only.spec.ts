import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

test.setTimeout(120_000);

const NOW = "2026-08-22T10:00:00.000Z";
const BRAND = {
  id: "brand_member_read_only",
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

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockMemberWorkspace(page: Page): Promise<void> {
  await page.route(/\/api\/connections(?:\?.*)?$/, (route) =>
    json(route, {
      workspace: { name: "Read-only Workspace" },
      connections: [{
        name: "Google Analytics 4",
        platform: "ga4",
        connectorPlatform: "ga4",
        category: "measurement",
        connectionAvailability: "available",
        description: "Website measurement",
        configured: true,
        status: "disconnected",
      }],
    }),
  );
  await page.route(/\/api\/brands(?:\?.*)?$/, (route) => json(route, { brands: [BRAND] }));
  await page.route(/\/api\/conversations(?:\?.*)?$/, (route) => json(route, { conversations: [] }));
  await page.route(/\/api\/billing(?:\?.*)?$/, (route) =>
    json(route, {
      billing: {
        canManage: false,
        plan: { name: "Solo Founder" },
        entitlements: { canUseOpus: false, maxConnections: 3 },
        resources: { connections: 0 },
      },
    }),
  );
  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    json(route, { calendar: { timezone: BRAND.timezone, plans: [], contentItems: [], publications: [] } }),
  );
  await page.route(/\/api\/content\/items(?:\?.*)?$/, (route) =>
    json(route, { items: [], nextCursor: null }),
  );
  await page.route(/\/api\/assets(?:\?.*)?$/, (route) =>
    json(route, { assets: [], capabilities: { imageGeneration: false }, nextCursor: null }),
  );
}

test("a member can inspect the workspace without seeing usable mutation controls", async ({ page }) => {
  await mockMemberWorkspace(page);
  await page.goto("/app?mode=assistant");

  const composer = page.getByPlaceholder("Read-only workspace");
  await expect(composer).toBeDisabled();
  await expect(page.getByTestId("chat-submit")).toBeDisabled();

  await page.getByRole("button", { name: "Manage connections", exact: true }).click();
  const connections = page.getByRole("dialog", { name: "Manage connections" });
  await expect(connections.getByText("Read-only access. An owner or admin manages workspace connections.")).toBeVisible();
  const readOnlyConnectionButtons = connections.getByRole("button", { name: "Read only" });
  expect(await readOnlyConnectionButtons.count()).toBeGreaterThan(0);
  for (const button of await readOnlyConnectionButtons.all()) await expect(button).toBeDisabled();
  await connections.getByRole("button", { name: "Close connections" }).click();

  await page.getByRole("button", { name: "Organic + SEO", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Content planner" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask assistant" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Plan next week" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add post", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "New plan" })).toBeDisabled();
  await expect(page.getByText("This calendar is read-only for your workspace role.")).toBeVisible();

  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Content Studio" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Draft with AI" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "New idea" })).toBeDisabled();
  await expect(page.getByText("This workspace is read-only for your role.")).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
