import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { PolicyDto, CheckDto, WorkspaceDto } from "../src/lib/paid-agents/dto";

const NOW = "2026-09-06T12:00:00.000Z";
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function setup(page: Page, options: { manager?: boolean; entitled?: boolean; worker?: boolean } = {}) {
  const commands: Record<string, unknown>[] = [];
  let policies: PolicyDto[] = [];
  let checks: CheckDto[] = [];
  const data = (): WorkspaceDto => ({
    canManage: options.manager ?? true, entitled: options.entitled ?? true, workerAvailable: options.worker ?? true, policies,
    connections: [{ id: "connection_google", platform: "google_ads", externalAccountId: "1234567890", displayName: "Launch account", status: "connected", currency: "EUR", timezone: "Europe/Madrid" }],
  });
  await page.route(/\/api\/connections(?:\?.*)?$/, (route) => json(route, { workspace: { name: "Paid goals QA" }, connections: [] }));
  await page.route(/\/api\/brands(?:\?.*)?$/, (route) => json(route, { brands: [] }));
  await page.route(/\/api\/conversations(?:\?.*)?$/, (route) => json(route, { conversations: [] }));
  await page.route(/\/api\/billing(?:\?.*)?$/, (route) => json(route, { billing: { canManage: options.manager ?? true, plan: { name: "Solo" }, entitlements: { canUseOpus: false, canExecuteActions: options.entitled ?? true }, resources: { connections: 1 } } }));
  await page.route(/\/api\/paid-agents(?:\/.*)?$/, async (route) => {
    if (route.request().method() === "GET") return json(route, new URL(route.request().url()).pathname.endsWith("/checks") ? { checks, nextCursor: null } : data());
    const body = route.request().postDataJSON(); commands.push(body);
    if (body.kind === "create") {
      policies = [{ ...body.policy, id: "goal_1", platform: "google_ads", accountId: "1234567890", accountName: "Launch account", currency: "EUR", timezone: "Europe/Madrid", version: 1, status: "active", lastCheckAt: null, nextCheckAt: NOW, checks: [] }];
    } else if (body.kind === "check") {
      checks = [{ id: "check_1", policyVersion: policies[0].version, status: "needs_review", reason: "The observed account result is outside the saved goal. Human review is required.", reviewStatus: "pending", reviewExpiresAt: "2099-01-01T00:00:00Z", reviewedAt: null, startedAt: NOW, completedAt: NOW, createdAt: NOW, syncAttemptId: "sync_1", snapshot: { goal: "min_roas", threshold: 2, currency: "EUR", windowDays: 7 }, result: { status: "needs_review", code: "threshold_breached", reason: "Below saved goal", observed: 1.5, spend: 100, revenue: 150, conversions: 5, recommendation: "Review attribution and campaign-level performance. No campaign changes have been made.", syncedAt: NOW, range: { from: "2026-08-30T00:00:00Z", to: "2026-09-05T00:00:00Z" } } }];
      policies[0].lastCheckAt = NOW; policies[0].checks = checks;
    } else if (body.kind === "review") {
      checks[0].reviewStatus = body.decision; checks[0].reviewedAt = NOW;
    } else if (body.kind === "pause" || body.kind === "resume") {
      policies[0].status = body.kind === "pause" ? "paused" : "active"; policies[0].version++;
      policies[0].nextCheckAt = body.kind === "pause" ? null : NOW;
    }
    return json(route, { policyId: "goal_1", ...(body.kind === "check" ? { checkId: "check_1", dispatched: true } : { dispatched: null }) });
  });
  return commands;
}

for (const width of [1440, 390]) {
  test(`paid goals ${width}px: no-brand save, fresh check, review, pause and resume`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
    const commands = await setup(page);
    await page.goto("/app?mode=agents");
    await expect(page.getByRole("heading", { name: "Paid agents", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Start organic|Paid campaign health check|Audit website/i })).toHaveCount(0);
    await page.getByRole("button", { name: "New goal", exact: true }).click();
    const form = page.getByRole("dialog", { name: "New paid goal" });
    await expect(form).toBeVisible();
    const dialogA11y = await new AxeBuilder({ page }).include('dialog[aria-labelledby="paid-goal-title"]').analyze();
    expect(dialogA11y.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);
    await form.getByLabel("Goal name").fill("Maintain ROAS at least two");
    await expect(form.getByLabel("Goal threshold")).toHaveValue("2");
    await form.getByRole("button", { name: "Save goal" }).click();
    await expect(form).toBeHidden();
    await page.getByRole("button", { name: "Check now", exact: true }).click();
    await expect(page.getByText("Review recommended", { exact: true })).toBeVisible();
    await expect(page.getByText(/Observed 1.5 x/)).toBeVisible();
    await page.getByRole("button", { name: "Acknowledge recommendation" }).click();
    await expect(page.getByText("Review: acknowledged", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Pause goal", exact: true }).click();
    await expect(page.getByRole("button", { name: "Check now", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Resume goal", exact: true }).click();
    await expect(page.getByRole("button", { name: "Check now", exact: true })).toBeEnabled();
    expect(commands.map((command) => command.kind)).toEqual(["create", "check", "review", "pause", "resume"]);
    expect(commands.every((command) => typeof command.requestId === "string" && !("brandId" in command))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const mainA11y = await new AxeBuilder({ page }).include('section[aria-label="Goal details"]').analyze();
    expect(mainA11y.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);
    await page.screenshot({ path: info.outputPath(`paid-goals-${width}.png`), fullPage: true, animations: "disabled" });
  });
}

test("paid goals fail visibly when worker is unavailable or entitlement is missing", async ({ page }) => {
  await setup(page, { worker: false, entitled: false });
  await page.goto("/app?mode=agents");
  await expect(page.getByText(/Scheduler unavailable/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Review plan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New goal", exact: true })).toBeDisabled();
});
