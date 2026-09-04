import { expect, test, type Page, type Route } from "@playwright/test";

import type { AgentRunDto } from "../src/lib/agent-runs/dto";

test.setTimeout(180_000);

const NOW = "2026-08-21T12:00:00.000Z";
const HASH = "0123456789abcdef".repeat(4);
const BRAND = {
  id: "brand_agent_runs",
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

function run(overrides: Partial<AgentRunDto> = {}): AgentRunDto {
  return {
    id: "run_organic",
    brandId: BRAND.id,
    conversationId: null,
    mode: "organic",
    goal: "Create a seven-day organic distribution plan",
    planKey: "organic_weekly_plan",
    target: null,
    status: "running",
    dispatchStatus: "sent",
    dispatchErrorCode: null,
    limits: { maxSteps: 24, maxToolCalls: 40, maxModelTurns: 12, maxWebReads: 6, maxCredits: 20 },
    usage: { steps: 1, toolCalls: 1, modelTurns: 0, webReads: 0, credits: 1 },
    attempt: 1,
    version: 2,
    failure: null,
    deadlineAt: "2026-08-21T12:15:00.000Z",
    cancelRequestedAt: null,
    startedAt: NOW,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    steps: [
      {
        id: "step_organic",
        ordinal: 1,
        attempt: 1,
        toolName: "organic.plan.weekly",
        risk: "internal_write",
        status: "running",
        approvalBinding: null,
        output: null,
        error: null,
        createdAt: NOW,
        completedAt: null,
      },
    ],
    events: [
      {
        id: "event_queued",
        sequence: 1,
        type: "run_queued",
        label: "Agent run queued",
        detail: "Waiting for the bounded worker",
        objectType: null,
        objectId: null,
        evidenceIds: [],
        createdAt: NOW,
      },
      {
        id: "event_started",
        sequence: 2,
        type: "run_started",
        label: "Agent run started",
        detail: "Using the reviewed organic workflow",
        objectType: null,
        objectId: null,
        evidenceIds: ["evidence_private_id"],
        createdAt: NOW,
      },
    ],
    approvals: [],
    ...overrides,
  };
}

function approvalRun(): AgentRunDto {
  return run({
    id: "run_approval",
    mode: "paid",
    goal: "Prepare the reviewed paid draft for an assisted handoff",
    planKey: "paid_create_paused",
    status: "waiting_approval",
    target: {
      kind: "paid_create_paused",
      objectType: "paid_campaign_draft",
      objectId: "draft_1",
      objectVersion: 3,
      snapshotHash: HASH,
      accountId: "account_1",
      expiresAt: "2099-08-22T12:00:00.000Z",
    },
    steps: [
      {
        id: "step_approval",
        ordinal: 1,
        attempt: 1,
        toolName: "paid.create.paused",
        risk: "external",
        status: "waiting_approval",
        approvalBinding: {
          kind: "paid_create_paused",
          objectType: "paid_campaign_draft",
          objectId: "draft_1",
          objectVersion: 3,
          snapshotHash: HASH,
          accountId: "account_1",
          expiresAt: "2099-08-22T12:00:00.000Z",
        },
        output: null,
        error: null,
        createdAt: NOW,
        completedAt: null,
      },
    ],
    events: [
      {
        id: "event_approval",
        sequence: 1,
        type: "approval_required",
        label: "Exact approval required",
        detail: "Review the immutable campaign draft version",
        objectType: "paid_campaign_draft",
        objectId: "draft_1",
        evidenceIds: [],
        createdAt: NOW,
      },
    ],
  });
}

type BillingAccess = "allowed" | "restricted" | "unavailable";

async function mockApp(page: Page, canManage: boolean, initialBillingAccess: BillingAccess = "allowed") {
  let billingAccess = initialBillingAccess;
  let runs = [approvalRun(), run()];
  const mutations: Array<{ path: string; body: Record<string, unknown> }> = [];
  const paidConnection = {
    id: "connection_google_ads",
    platform: "google_ads",
    accountId: "1234567890",
    accountName: "Fitura Ads",
    currency: "EUR",
    timezone: "Europe/Madrid",
    lastSuccessfulSyncAt: NOW,
  };

  await page.route(/\/api\/connections(?:\?.*)?$/, (route) =>
    json(route, { workspace: { name: "Solo Founder" }, connections: [] }),
  );
  await page.route(/\/api\/brands(?:\?.*)?$/, (route) => json(route, { brands: [BRAND] }));
  await page.route(/\/api\/conversations(?:\?.*)?$/, (route) => json(route, { conversations: [] }));
  await page.route(/\/api\/billing(?:\?.*)?$/, (route) => {
    if (billingAccess === "unavailable") {
      return json(route, { error: "billing_unavailable" }, 503);
    }
    return json(route, {
      billing: {
        canManage,
        plan: { id: billingAccess === "allowed" ? "solo" : "free", name: billingAccess === "allowed" ? "Solo Founder" : "Free" },
        entitlements: { canUseOpus: false, canExecuteActions: billingAccess === "allowed" },
        resources: { connections: 0 },
      },
    });
  });

  await page.route(/\/api\/agent-runs(?:\/.*)?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const body = method === "GET" ? {} : (request.postDataJSON() as Record<string, unknown>);
    if (method !== "GET") mutations.push({ path, body });

    if (path === "/api/agent-runs" && method === "GET") {
      await json(route, { runs });
      return;
    }
    if (path === "/api/agent-runs/paid-connections" && method === "GET") {
      await json(route, { connections: [paidConnection] });
      return;
    }
    if (path === "/api/agent-runs" && method === "POST") {
      const paidTarget = body.target as Record<string, unknown> | null;
      const isPaidMonitor = body.mode === "paid" && paidTarget?.kind === "paid_monitor";
      const created = run({
        id: isPaidMonitor ? "run_paid_created" : "run_created",
        mode: isPaidMonitor ? "paid" : "organic",
        goal: String(body.goal),
        planKey: isPaidMonitor ? "paid.monitor.v1" : "organic.weekly_plan.v1",
        target: isPaidMonitor
          ? {
              kind: "paid_monitor",
              connectionId: paidConnection.id,
              platform: "google_ads",
              accountId: paidConnection.accountId,
              accountName: paidConnection.accountName,
              from: String(paidTarget.from),
              to: String(paidTarget.to),
              boundAt: NOW,
            }
          : null,
        status: "queued",
        dispatchStatus: "sent",
        usage: { steps: 0, toolCalls: 0, modelTurns: 0, webReads: 0, credits: 0 },
        steps: [],
        events: [],
        updatedAt: "2026-08-21T12:01:00.000Z",
      });
      runs = [created, ...runs];
      await json(route, { run: created, replayed: false }, 201);
      return;
    }
    if (path === "/api/agent-runs/run_approval/approvals" && method === "POST") {
      const current = runs.find((candidate) => candidate.id === "run_approval")!;
      const approved = {
        ...current,
        status: "queued" as const,
        dispatchStatus: "sent" as const,
        approvals: [
          {
            id: "approval_accepted",
            stepId: "step_approval",
            decision: "accepted" as const,
            kind: "paid_create_paused" as const,
            objectType: "paid_campaign_draft",
            objectId: "draft_1",
            objectVersion: 3,
            snapshotHash: HASH,
            accountId: "account_1",
            expiresAt: "2099-08-22T12:00:00.000Z",
            decidedAt: NOW,
          },
        ],
        updatedAt: "2026-08-21T12:02:00.000Z",
      };
      runs = runs.map((candidate) => candidate.id === approved.id ? approved : candidate);
      await json(route, { run: approved, replayed: false });
      return;
    }
    if (path === "/api/agent-runs/run_created/cancel" && method === "POST") {
      const current = runs.find((candidate) => candidate.id === "run_created")!;
      const cancelled = {
        ...current,
        status: "cancelled" as const,
        completedAt: "2026-08-21T12:03:00.000Z",
        updatedAt: "2026-08-21T12:03:00.000Z",
      };
      runs = runs.map((candidate) => candidate.id === cancelled.id ? cancelled : candidate);
      await json(route, { run: cancelled, replayed: false });
      return;
    }
    const id = path.split("/")[3];
    if (method === "GET" && id) {
      const found = runs.find((candidate) => candidate.id === id);
      await json(route, found ? { run: found } : { code: "agent_run_not_found" }, found ? 200 : 404);
      return;
    }
    await json(route, { code: "unexpected_request" }, 500);
  });

  return {
    mutations,
    setBillingAccess: (access: BillingAccess) => { billingAccess = access; },
  };
}

test("owner can inspect, approve, start, and cancel exact bounded runs", async ({ page }) => {
  const harness = await mockApp(page, true);
  await page.goto("/app?mode=agents");

  await expect(page.getByRole("heading", { name: "Agent runs", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Agent runs", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", {
      name: "Prepare the reviewed paid draft for an assisted handoff",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(HASH)).toHaveCount(0);
  await expect(page.getByText("...89abcdef").first()).toBeVisible();

  await page.getByRole("button", { name: "Review and approve" }).click();
  const approvalDialog = page.getByRole("dialog", { name: "Approve exact operation" });
  await expect(approvalDialog).toBeVisible();
  await expect(approvalDialog.getByText("...89abcdef")).toBeVisible();
  await approvalDialog.getByRole("button", { name: "Approve this version" }).click();
  await expect(page.getByText("The exact operation was approved and the run was queued to continue.")).toBeVisible();

  const approvalMutation = harness.mutations.find((entry) => entry.path.endsWith("/approvals"));
  expect(approvalMutation?.body).toMatchObject({
    decision: "accepted",
    stepId: "step_approval",
    kind: "paid_create_paused",
    objectType: "paid_campaign_draft",
    objectId: "draft_1",
    objectVersion: 3,
    snapshotHash: HASH,
    accountId: "account_1",
  });
  expect(String(approvalMutation?.body.requestId)).toMatch(/^[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "New organic plan" }).click();
  const startDialog = page.getByRole("dialog", { name: "Start an organic plan" });
  await startDialog.getByLabel("Goal").fill("Plan seven days of founder distribution posts");
  await startDialog.getByRole("button", { name: "Start plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan seven days of founder distribution posts" })).toBeVisible();

  const createMutation = harness.mutations.find((entry) => entry.path === "/api/agent-runs");
  expect(createMutation?.body).toMatchObject({
    brandId: BRAND.id,
    conversationId: null,
    goal: "Plan seven days of founder distribution posts",
    mode: "organic",
    target: null,
  });
  expect(String(createMutation?.body.requestId)).toMatch(/^[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const cancelDialog = page.getByRole("dialog", { name: "Cancel this run?" });
  await expect(cancelDialog).toBeVisible();
  await cancelDialog.getByRole("button", { name: "Cancel run" }).click();
  await expect(page.getByText("Cancellation was requested.")).toBeVisible();
  const cancelMutation = harness.mutations.find((entry) => entry.path.endsWith("/cancel"));
  expect(Object.keys(cancelMutation?.body ?? {})).toEqual(["requestId"]);
  expect(String(cancelMutation?.body.requestId)).toMatch(/^[0-9a-f-]{36}$/);

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("owner can start an account-bound one-time paid health check", async ({ page }) => {
  const harness = await mockApp(page, true);
  await page.goto("/app?mode=agents");

  await page.getByRole("button", { name: "Paid campaign health check", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Paid campaign health check", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/One-time, read-only check/)).toBeVisible();
  await expect(dialog.getByLabel("Connected account")).toHaveValue("connection_google_ads");
  await dialog.getByLabel("Recent window").selectOption("7");
  await dialog.getByLabel("Health-check goal").fill("Find paid delivery risks for Fitura");
  await dialog.getByRole("button", { name: "Run health check" }).click();

  await expect(page.getByRole("heading", { name: "Find paid delivery risks for Fitura" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "One-time paid campaign health check" })).toBeVisible();
  await expect(page.getByText(/does not contact providers/)).toBeVisible();

  const mutation = harness.mutations.find(
    (entry) => entry.path === "/api/agent-runs" && entry.body.mode === "paid",
  );
  expect(mutation?.body).toMatchObject({
    brandId: BRAND.id,
    conversationId: null,
    goal: "Find paid delivery risks for Fitura",
    mode: "paid",
    target: {
      kind: "paid_monitor",
      connectionId: "connection_google_ads",
    },
  });
  const target = mutation?.body.target as Record<string, unknown>;
  expect(String(target.from)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(String(target.to)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const from = new Date(`${String(target.from)}T00:00:00.000Z`);
  const to = new Date(`${String(target.to)}T00:00:00.000Z`);
  expect(Math.round((to.getTime() - from.getTime()) / 86_400_000)).toBe(6);
});

const START_DIALOGS = [
  { mode: "organic", action: "New organic plan", title: "Start an organic plan", goal: "Goal", submit: "Start plan" },
  { mode: "paid", action: "Paid campaign health check", title: "Paid campaign health check", goal: "Health-check goal", submit: "Run health check" },
] as const;

for (const start of START_DIALOGS) {
  test(`${start.mode} start shows the Free plan restriction before editing or submitting`, async ({ page }) => {
    const harness = await mockApp(page, true, "restricted");
    await page.goto("/app?mode=agents");
    await page.getByRole("button", { name: start.action, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: start.title, exact: true });

    await expect(dialog.getByRole("status")).toContainText("Your current plan does not include automated agent actions.");
    await expect(dialog.getByRole("link", { name: "Review plan" })).toHaveAttribute("href", "/settings/billing");
    await expect(dialog.getByLabel(start.goal, { exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: start.submit, exact: true })).toBeDisabled();
    if (start.mode === "paid") {
      await expect(dialog.getByLabel("Connected account")).toHaveValue("connection_google_ads");
      await expect(dialog.getByLabel("Connected account")).toBeDisabled();
      await expect(dialog.getByLabel("Recent window")).toBeDisabled();
      await expect(dialog.getByText(/One-time, read-only check/)).toBeVisible();
      await expect(dialog.getByText(/does not contact ad platforms, change campaigns, or schedule future checks/)).toBeVisible();
    }

    // Exercise the submit guard independently of the disabled submit button.
    await dialog.locator("form").dispatchEvent("submit");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(harness.mutations).toEqual([]);

    harness.setBillingAccess("allowed");
    await page.getByRole("button", { name: start.action, exact: true }).click();
    await expect(dialog.getByLabel(start.goal, { exact: true })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: start.submit, exact: true })).toBeEnabled();
    await expect(dialog.getByRole("link", { name: "Review plan" })).toHaveCount(0);
    expect(harness.mutations).toEqual([]);
  });

  test(`${start.mode} start fails closed when plan access is unavailable and can retry`, async ({ page }) => {
    const harness = await mockApp(page, true);
    await page.goto("/app?mode=agents");
    const action = page.getByRole("button", { name: start.action, exact: true });
    // Resolve shell permissions first, then fail the dialog's fresh billing read.
    await expect(action).toBeVisible();
    harness.setBillingAccess("unavailable");
    await action.click();
    const dialog = page.getByRole("dialog", { name: start.title, exact: true });

    await expect(dialog.getByRole("alert")).toContainText("Plan access could not be checked. No run has been started.");
    await expect(dialog.getByRole("link", { name: "Review plan" })).toHaveCount(0);
    await expect(dialog.getByLabel(start.goal, { exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: start.submit, exact: true })).toBeDisabled();
    if (start.mode === "paid") {
      await expect(dialog.getByLabel("Connected account")).toHaveValue("connection_google_ads");
    }
    await dialog.locator("form").dispatchEvent("submit");
    expect(harness.mutations).toEqual([]);

    const failedRetry = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/billing" && response.status() === 503,
    );
    await dialog.getByRole("button", { name: "Try again", exact: true }).click();
    await failedRetry;
    await expect(dialog.getByRole("alert")).toContainText("Plan access could not be checked.");
    await expect(dialog.getByRole("button", { name: start.submit, exact: true })).toBeDisabled();
    expect(harness.mutations).toEqual([]);

    harness.setBillingAccess("allowed");
    await dialog.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(dialog.getByLabel(start.goal, { exact: true })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: start.submit, exact: true })).toBeEnabled();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(harness.mutations).toEqual([]);
  });
}

test("member view exposes history without mutation controls", async ({ page }) => {
  await mockApp(page, false);
  await page.goto("/app?mode=agents");

  await expect(page.getByText("Read-only access.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Paid campaign health check", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New organic plan" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review and approve" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
});
