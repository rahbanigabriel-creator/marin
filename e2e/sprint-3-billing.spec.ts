import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import type { BillingSnapshotDto } from "../src/lib/billing/types";
import type { Channel } from "../src/types/views";

const PERIOD_START = "2026-07-01T00:00:00.000Z";
const PERIOD_END = "2026-08-01T00:00:00.000Z";

function billingSnapshot(plan: "free" | "solo"): BillingSnapshotDto {
  const solo = plan === "solo";
  return {
    billingConfigured: true,
    canManage: true,
    plan: {
      id: plan,
      name: solo ? "Solo Founder" : "Free",
      priceEurMonthly: solo ? 39.99 : 0,
      priceEurAnnual: solo ? 399 : null,
    },
    subscription: solo
      ? {
          status: "active",
          billingInterval: "annual",
          currentPeriodStart: PERIOD_START,
          currentPeriodEnd: "2027-07-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
        }
      : null,
    usage: {
      included: solo ? 120 : 25,
      committed: solo ? 17 : 9,
      reserved: 1,
      remaining: solo ? 102 : 15,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    },
    resources: {
      connections: solo ? 3 : 1,
      brands: 1,
      seats: 1,
      scheduledPosts: solo ? 17 : 3,
      storageUsedBytes: solo ? 412 * 1024 ** 2 : 18 * 1024 ** 2,
    },
    entitlements: {
      maxConnections: solo ? 4 : 1,
      maxBrands: 1,
      maxSeats: 1,
      maxScheduledPosts: solo ? 100 : 10,
      storageBytes: solo ? 5 * 1024 ** 3 : 250 * 1024 ** 2,
      canUseOpus: false,
      canExecuteActions: solo,
    },
    checkout: { monthlyConfigured: true, annualConfigured: true },
  };
}

async function mockWorkspace(
  page: Page,
  billing: BillingSnapshotDto,
  connections: Channel[] = [],
): Promise<void> {
  await page.route(/\/api\/billing(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ billing }),
    });
  });
  await page.route(/\/api\/connections(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspace: { name: "Solo Founder Workspace" },
        connections,
      }),
    });
  });
  await page.route(/\/api\/brands(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true, brands: [] }),
    });
  });
  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true, conversations: [] }),
    });
  });
}

test("Free billing is discoverable and opens the selected Stripe checkout interval", async ({ page }) => {
  const billing = billingSnapshot("free");
  await mockWorkspace(page, billing);

  let checkoutBody: unknown = null;
  await page.route(/\/api\/billing\/checkout$/, async (route) => {
    checkoutBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: "/stripe-checkout" }),
    });
  });
  await page.route("**/stripe-checkout", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<main><h1>Secure Stripe fixture</h1></main>",
    });
  });

  await page.goto("/app");
  const model = page.getByRole("combobox", { name: "Model" });
  await expect(model.locator('option[value="claude-opus-4-8"]')).toBeDisabled();

  await page.getByRole("button", { name: "Account menu" }).evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  const billingLink = page.getByRole("link", { name: "Billing & usage" });
  await expect(billingLink).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/settings\/billing$/),
    billingLink.click({ force: true }),
  ]);
  await expect(page.getByRole("heading", { name: "Billing and usage" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Monthly Marpin credit usage" })).toHaveAttribute(
    "aria-valuenow",
    "10",
  );
  await expect(page.getByText("15 remaining")).toBeVisible();
  await expect(page.getByText("3 of 10 used")).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    ),
  ).toEqual([]);

  await page.getByRole("button", { name: "Monthly", exact: true }).click();
  await page.getByRole("button", { name: "Upgrade to Solo" }).click();
  await expect(page.getByRole("heading", { name: "Secure Stripe fixture" })).toBeVisible();
  expect(checkoutBody).toEqual({ plan: "solo", interval: "monthly" });
});

test("connection limits are visible before OAuth and reconnect remains available", async ({ page }) => {
  const billing = billingSnapshot("free");
  const connections: Channel[] = [
    {
      name: "Google Analytics 4",
      platform: "ga4",
      connectorPlatform: "ga4",
      category: "measurement",
      connectionAvailability: "available",
      configured: true,
      status: "connected",
      displayName: "Marpin GA4",
    },
    {
      name: "Google Search Console",
      platform: "search_console",
      connectorPlatform: "search_console",
      category: "measurement",
      connectionAvailability: "available",
      configured: true,
      status: "disconnected",
    },
  ];
  await mockWorkspace(page, billing, connections);

  await page.goto("/app");
  await page.getByRole("button", { name: "Manage connections", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manage connections" });
  await expect(dialog.getByText("1 of 1 connections used")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Reconnect" })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Limit reached" })).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "View plans" })).toHaveAttribute(
    "href",
    "/settings/billing",
  );
});

test("credit exhaustion shows a typed upgrade path while Extra remains launch-disabled", async ({ page }) => {
  const free = billingSnapshot("free");
  await mockWorkspace(page, free);
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 402,
      contentType: "application/json",
      body: JSON.stringify({
        error: "credit_limit",
        message: "You have used all 25 Free credits for this month.",
        actionUrl: "/settings/billing",
        actionLabel: "View plans",
      }),
    });
  });

  await page.goto("/app");
  await page.getByRole("textbox", { name: "Enter your website URL" }).fill("Plan my launch");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByTestId("chat-error")).toContainText("all 25 Free credits");
  await expect(page.getByRole("link", { name: "View plans" })).toHaveAttribute(
    "href",
    "/settings/billing",
  );

  const solo = billingSnapshot("solo");
  await page.unroute(/\/api\/billing(?:\?.*)?$/);
  await page.route(/\/api\/billing(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ billing: solo }),
    });
  });
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Model" }).locator('option[value="claude-opus-4-8"]'),
  ).toBeDisabled();
});

test("billing remains usable without horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkspace(page, billingSnapshot("free"));

  await page.goto("/settings/billing");
  await expect(page.getByRole("heading", { name: "Billing and usage" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Annual · recommended" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upgrade to Solo" })).toBeVisible();

  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    widestButton: Math.max(
      ...Array.from(document.querySelectorAll("button")).map(
        (button) => button.scrollWidth - button.clientWidth,
      ),
    ),
  }));
  expect(layout.overflow).toBe(0);
  expect(layout.widestButton).toBeLessThanOrEqual(0);
});
