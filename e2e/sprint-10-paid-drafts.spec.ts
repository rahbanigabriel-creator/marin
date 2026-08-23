import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  PaidCampaignApprovalDto,
  PaidCampaignDraftDto,
  PaidCampaignOperationAttemptDto,
} from "../src/lib/paid-drafts/dto";
import type { PaidCampaignSnapshotV1 } from "../src/lib/paid-drafts/types";

test.setTimeout(180_000);

const NOW = "2026-08-21T12:00:00.000Z";
const BRAND = {
  id: "brand_paid_drafts",
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

function capabilities(
  state: string,
  canConfirmProviderPaused = false,
): PaidCampaignDraftDto["capabilities"] {
  const assisted = (operation: "create_paused" | "activate" | "change_budget") => ({
    operation,
    path: "assisted" as const,
    canExecuteProvider: false,
    assistedHandoffAvailable: true as const,
    reason: "provider_review_required" as const,
  });
  return {
    canManage: true,
    canEdit: state === "draft",
    canMarkReady: state === "draft",
    canApproveCreatePaused: state === "ready",
    canConfirmProviderPaused,
    canApproveActivation: state === "provider_paused",
    execution: {
      mode: "assisted" as const,
      createPaused: assisted("create_paused"),
      activation: assisted("activate"),
      budgetChange: assisted("change_budget"),
    },
  };
}

async function mockApp(page: Page) {
  let draft: PaidCampaignDraftDto | null = null;
  const mutations: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];

  await page.route(/\/api\/brands(?:\?.*)?$/, (route) => json(route, { brands: [BRAND] }));
  await page.route(/\/api\/conversations(?:\?.*)?$/, (route) => json(route, { conversations: [] }));
  await page.route(/\/api\/billing(?:\?.*)?$/, (route) => json(route, { billing: { canManage: true, entitlements: { canUseOpus: false }, resources: { connections: 1 } } }));
  await page.route(/\/api\/dashboard(?:\?.*)?$/, (route) => json(route, {
    mode: "empty",
    data: { range: { from: "2026-07-23", to: "2026-08-21", days: 30 }, accounts: [], campaigns: [], platforms: [], series: [], totals: { metrics: {} }, previous: { metrics: {} } },
  }));
  await page.route(/\/api\/connections(?:\?.*)?$/, (route) => json(route, {
    workspace: { name: "Solo Founder" },
    accounts: [{
      platform: "google_ads",
      connectorPlatform: "google_ads",
      name: "Google Ads",
      connectionId: "connection_google_founder",
      status: "connected",
      externalAccountId: "123-456-7890",
      displayName: "Founder Search Account",
      currency: "EUR",
      timezone: "Europe/Madrid",
    }],
    connections: [],
  }));
  await page.route(/\/api\/assets(?:\?.*)?$/, (route) => json(route, { assets: [], capabilities: { imageGeneration: false }, nextCursor: null }));

  await page.route(/\/api\/paid\/drafts(?:\/.*)?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const body = method === "GET" ? {} : request.postDataJSON() as Record<string, unknown>;
    if (method !== "GET") mutations.push({ method, path, body });

    if (path === "/api/paid/drafts" && method === "GET") {
      await json(route, { drafts: draft ? [draft] : [] });
      return;
    }
    if (path === "/api/paid/drafts/generate" && method === "POST") {
      const snapshot: PaidCampaignSnapshotV1 = {
        schemaVersion: 1,
        source: "ai",
        platform: "google_ads",
        template: "google_search_rsa",
        connection: { platform: "google_ads", connectionId: "connection_google_founder", accountId: "123-456-7890", accountName: "Founder Search Account" },
        campaign: { name: "AI founder search draft", objective: "traffic" },
        budget: { amountMinor: 5000, currency: "EUR", cadence: "daily" },
        schedule: { startsAt: "2026-08-22T09:00:00+02:00", endsAt: "2026-08-29T23:00:00+02:00", timezone: "Europe/Madrid" },
        assumptions: ["Human review is required."],
        adGroups: [{
          localId: "group_ai_1",
          name: "Founder distribution",
          targeting: { kind: "search", locations: ["Spain"], languages: ["English"], keywords: [{ text: "marketing operating system", matchType: "exact" }], negativeKeywords: [] },
          ads: [{ localId: "ad_ai_1", name: "AI founder RSA", format: "responsive_search", assetIds: [], headlines: ["Ship distribution faster", "Your marketing command center", "Plan every growth channel"], descriptions: ["Audit and plan distribution in one workspace.", "Build a launch plan without losing context."], destinationUrl: "https://www.marpin.ai/", path1: null, path2: null }],
        }],
      };
      draft = {
        id: "paid_draft_ai_1",
        platform: "google_ads",
        connection: snapshot.connection,
        source: "ai",
        template: "google_search_rsa",
        state: "draft",
        snapshot,
        snapshotHash: "d".repeat(64),
        version: 1,
        readyAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        capabilities: capabilities("draft"),
        approvals: [],
        attempts: [],
      };
      await json(route, { draft, replayed: false, credits: 3, model: "claude-sonnet" }, 201);
      return;
    }
    if (path === "/api/paid/drafts" && method === "POST") {
      const snapshot = body.snapshot as PaidCampaignSnapshotV1;
      draft = {
        id: "paid_draft_1",
        platform: "google_ads",
        connection: snapshot.connection,
        source: "manual",
        template: "google_search_rsa",
        state: "draft",
        snapshot,
        snapshotHash: "a".repeat(64),
        version: 1,
        readyAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        capabilities: capabilities("draft"),
        approvals: [],
        attempts: [],
      };
      await json(route, { draft, replayed: false }, 201);
      return;
    }
    if (path === "/api/paid/drafts/paid_draft_1" && method === "GET") {
      await json(route, { draft });
      return;
    }
    if (path === "/api/paid/drafts/paid_draft_1" && method === "PATCH" && draft) {
      draft = {
        ...draft,
        snapshot: body.snapshot as PaidCampaignSnapshotV1,
        connection: (body.snapshot as PaidCampaignSnapshotV1).connection,
        version: 2,
        snapshotHash: "b".repeat(64),
        updatedAt: "2026-08-21T12:05:00.000Z",
        approvals: [],
      };
      await json(route, { draft, replayed: false });
      return;
    }
    if (path.endsWith("/ready") && method === "POST" && draft) {
      draft = {
        ...draft,
        state: "ready",
        version: 3,
        snapshotHash: "c".repeat(64),
        readyAt: "2026-08-21T12:10:00.000Z",
        updatedAt: "2026-08-21T12:10:00.000Z",
        capabilities: capabilities("ready"),
      };
      await json(route, { draft, replayed: false });
      return;
    }
    if (path.endsWith("/approvals") && method === "POST" && draft) {
      const approval: PaidCampaignApprovalDto = {
        id: "approval_create_1",
        kind: body.kind as PaidCampaignApprovalDto["kind"],
        snapshotVersion: draft.version,
        snapshotHash: draft.snapshotHash,
        status: "approved",
        approvedAt: "2026-08-21T12:12:00.000Z",
        consumedByAttemptId: null,
      };
      draft = { ...draft, approvals: [approval, ...draft.approvals] };
      await json(route, { draft, approval, replayed: false }, 201);
      return;
    }
    if (path.endsWith("/operations") && method === "POST" && draft) {
      const attempt: PaidCampaignOperationAttemptDto = {
        id: "attempt_create_1",
        approvalId: body.approvalId as string,
        operation: body.operation as PaidCampaignOperationAttemptDto["operation"],
        snapshotVersion: draft.version,
        snapshotHash: draft.snapshotHash,
        status: "assisted_handoff",
        capabilityReason: "provider_review_required",
        providerOutcome: {
          kind: "assisted_handoff",
          providerSideEffect: "none",
          message: "Open the provider workspace and create this campaign in a paused state.",
          nextSteps: ["Review the exported settings.", "Create the campaign as paused in Google Ads."],
        },
        attemptedAt: "2026-08-21T12:15:00.000Z",
      };
      draft = {
        ...draft,
        approvals: draft.approvals.map((approval) => ({ ...approval, status: "consumed" as const, consumedByAttemptId: attempt.id })),
        attempts: [attempt, ...draft.attempts],
        capabilities: capabilities("ready", true),
      };
      await json(route, { draft, attempt, replayed: false }, 201);
      return;
    }
    if (path.endsWith("/provider-paused") && method === "POST" && draft) {
      const priorVersion = draft.version;
      draft = {
        ...draft,
        state: "provider_paused",
        version: priorVersion + 1,
        capabilities: capabilities("provider_paused"),
        providerPausedConfirmation: {
          providerCampaignId: String(body.providerCampaignId),
          verificationStatus: "user_asserted_unverified",
          snapshotVersion: priorVersion,
          snapshotHash: draft.snapshotHash,
          confirmedAt: "2026-08-21T12:20:00.000Z",
        },
      };
      await json(route, { draft, replayed: false }, 201);
      return;
    }
    await json(route, { error: "not_found" }, 404);
  });

  return { mutations, getDraft: () => draft };
}

test("creates, edits, reloads, approves, and prepares a no-side-effect paid handoff", async ({ page }) => {
  const mock = await mockApp(page);
  await page.goto("/app?mode=paid&view=campaigns&paidView=drafts");

  await expect(page.getByRole("heading", { name: "Campaign drafts" })).toBeVisible();
  await page.getByRole("button", { name: "New draft" }).click();
  await expect(page.getByRole("form", { name: "New paid campaign draft" })).toBeVisible();

  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText("Resolve 9 validation issues before saving.")).toBeVisible();

  await page.getByLabel("Campaign name").fill("Founder search launch");
  await page.getByRole("textbox", { name: "Budget", exact: true }).fill("50.00");
  await page.getByLabel("Ad group 1 name").fill("Marketing operating system");
  await page.getByLabel("Ad group 1 locations").fill("Spain");
  await page.getByLabel("Ad group 1 keywords").fill("exact: marketing operating system\nphrase: founder distribution");
  await page.getByLabel("Ad group 1 ad 1 name").fill("Founder RSA");
  await page.getByLabel("Ad group 1 ad 1 headlines").fill("Ship distribution faster\nYour marketing command center\nPlan every growth channel");
  await page.getByLabel("Ad group 1 ad 1 descriptions").fill("Audit and plan distribution in one workspace.\nBuild a launch plan without losing context.");
  await page.getByLabel("Ad group 1 ad 1 destination URL").fill("https://www.marpin.ai/paid");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("status")).toContainText("Campaign draft created");
  expect(mock.getDraft()?.snapshot.source).toBe("manual");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Campaign drafts" })).toBeVisible();
  await expect(page.getByLabel("Campaign name")).toHaveValue("Founder search launch");
  await page.getByLabel("Campaign name").fill("Founder search launch · reviewed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Draft v2 saved");

  await page.getByRole("button", { name: "Mark ready" }).click();
  await expect(page.getByText("Review exact snapshot")).toBeVisible();
  await expect(page.getByText("c".repeat(64))).toBeVisible();
  await expect(page.getByText("Activation is disabled until the campaign is independently confirmed as paused at the provider.")).toBeVisible();

  await page.getByRole("button", { name: "Approve create paused" }).click();
  const dialog = page.getByRole("dialog", { name: "Approve create paused" });
  await expect(dialog).toContainText("v3");
  await expect(dialog).toContainText("c".repeat(64));
  await expect(dialog).toContainText("no provider side effect");
  await dialog.getByRole("button", { name: "Approve exact snapshot" }).click();
  await expect(page.getByRole("status")).toContainText("Create-paused approval bound to v3");

  await page.getByRole("button", { name: "Prepare assisted handoff" }).click();
  await expect(page.getByRole("status")).toContainText("Marpin made no provider change and spent no budget");
  await expect(page.getByText("No provider side effect", { exact: true })).toBeVisible();
  await expect(page.getByText("Create the campaign as paused in Google Ads.")).toBeVisible();

  await page.getByRole("button", { name: "Confirm campaign is paused at provider" }).click();
  const providerDialog = page.getByRole("dialog", { name: "Confirm paused provider campaign" });
  await providerDialog.getByLabel("Provider campaign ID").fill("281498962108233");
  await providerDialog.getByLabel("I created this campaign in the provider and left it paused").check();
  await providerDialog.getByRole("button", { name: "Record paused campaign" }).click();
  await expect(page.getByRole("status")).toContainText("Campaign 281498962108233 was recorded as paused at the provider");
  await expect(page.getByText("Provider campaign 281498962108233 · user asserted, not provider-verified")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve activation" })).toBeEnabled();

  const create = mock.mutations.find((mutation) => mutation.path === "/api/paid/drafts" && mutation.method === "POST");
  expect(create?.body).toMatchObject({ connectionId: "connection_google_founder", snapshot: { source: "manual", platform: "google_ads", template: "google_search_rsa" } });
  const ready = mock.mutations.find((mutation) => mutation.path.endsWith("/ready"));
  expect(ready?.body).toMatchObject({ expectedVersion: 2, snapshotHash: "b".repeat(64) });
  const approval = mock.mutations.find((mutation) => mutation.path.endsWith("/approvals"));
  expect(approval?.body).toMatchObject({ kind: "create_paused", expectedVersion: 3, snapshotHash: "c".repeat(64) });
  const operation = mock.mutations.find((mutation) => mutation.path.endsWith("/operations"));
  expect(operation?.body).toMatchObject({ approvalId: "approval_create_1", operation: "create_paused", expectedVersion: 3, snapshotHash: "c".repeat(64) });
  const providerPaused = mock.mutations.find((mutation) => mutation.path.endsWith("/provider-paused"));
  expect(providerPaused?.body).toMatchObject({
    expectedVersion: 3,
    snapshotHash: "c".repeat(64),
    providerCampaignId: "281498962108233",
    confirmation: "I created this campaign in the provider and left it paused",
  });
});

test("AI entry uses the reviewed shared generation API and returns an editable saved draft", async ({ page }) => {
  const mock = await mockApp(page);
  await page.goto("/app?mode=paid&view=campaigns&paidView=drafts");
  await page.getByRole("button", { name: "Generate draft" }).click();
  const dialog = page.getByRole("dialog", { name: "Generate campaign draft" });
  await expect(dialog).toContainText("consumes AI credits, creates no provider campaign, and spends no budget");
  await dialog.getByLabel("AI draft direction").fill("Focus on technical solo founders launching their first product.");
  await dialog.getByRole("button", { name: "Generate saved draft" }).click();
  await expect(page.getByLabel("Campaign name")).toHaveValue("AI founder search draft");
  await expect(page.getByRole("status")).toContainText("AI draft created with 3 credits");
  const generation = mock.mutations.find((mutation) => mutation.path === "/api/paid/drafts/generate");
  expect(generation?.body).toMatchObject({
    connectionId: "connection_google_founder",
    template: "google_search_rsa",
    instruction: "Focus on technical solo founders launching their first product.",
  });
  expect(mock.getDraft()?.source).toBe("ai");
});

test("paid draft workspace remains usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApp(page);
  await page.goto("/app?mode=paid&view=campaigns&paidView=drafts");
  await expect(page.getByRole("heading", { name: "Campaign drafts" })).toBeVisible();
  await page.getByRole("button", { name: "New draft" }).click();
  const bounds = await page.evaluate(() => ({ viewport: window.innerWidth, width: document.documentElement.scrollWidth }));
  expect(bounds.width).toBeLessThanOrEqual(bounds.viewport);
  await expect(page.getByLabel("Campaign name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create draft" })).toBeVisible();
});
