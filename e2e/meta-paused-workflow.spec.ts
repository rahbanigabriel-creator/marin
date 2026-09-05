import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { PaidCampaignDraftDto, PaidCampaignOperationAttemptDto } from "../src/lib/paid-drafts/dto";
import type { MetaCampaignSnapshotV1 } from "../src/lib/paid-drafts/types";

test.setTimeout(120_000);
const NOW = "2026-09-05T12:00:00.000Z";
const HASH = "a".repeat(64);
const PREVIEW_IMAGE = readFileSync(`${process.cwd()}/public/marpin-logo.png`);
const BRAND = { id: "brand_meta", name: "Marpin", websiteUrl: "https://www.marpin.ai", isPrimary: true, summary: "Marketing software", audience: ["Founders"], voice: [], offers: [], competitors: [], proofPoints: [], visualStyle: [], locale: "en-US", timezone: "Europe/Madrid", currency: "EUR", contextVersion: 1, auditSnapshot: null, auditedAt: NOW, createdAt: NOW, updatedAt: NOW };
async function json(route: Route, payload: unknown, status = 200) { await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) }); }

function capability(state: PaidCampaignDraftDto["state"]): PaidCampaignDraftDto["capabilities"] {
  const assisted = (operation: "activate" | "change_budget") => ({ operation, path: "assisted" as const, canExecuteProvider: false, assistedHandoffAvailable: true as const, reason: "provider_review_required" as const });
  return { canManage: true, canEdit: state === "draft" || state === "ready", canMarkReady: state === "draft", canApproveCreatePaused: state === "ready", canApproveActivation: false, canConfirmProviderPaused: false,
    execution: { mode: "provider_checked", createPaused: { operation: "create_paused", path: "provider_checked", canExecuteProvider: true, assistedHandoffAvailable: true, reason: "provider_preflight_required" }, activation: assisted("activate"), budgetChange: assisted("change_budget") } };
}

function initialDraft(direct = true): PaidCampaignDraftDto {
  const snapshot: MetaCampaignSnapshotV1 = { schemaVersion: 1, source: "manual", platform: "meta_ads", template: "meta_traffic", connection: { platform: "meta_ads", connectionId: "connection_meta", accountId: "123456789", accountName: "Founder Meta Account" }, campaign: { name: "Marpin paused launch", objective: "traffic" }, budget: { amountMinor: 2500, currency: "EUR", cadence: "daily" }, schedule: { startsAt: "2030-09-06T09:00:00+02:00", endsAt: "2030-09-13T09:00:00+02:00", timezone: "Europe/Madrid" }, assumptions: [],
    adGroups: [{ localId: "group_1", name: "Spanish founders", targeting: { kind: "audience", locations: direct ? ["ES"] : ["Spain"], languages: direct ? ["All languages"] : ["Spanish"], ageMin: 25, ageMax: 55, genders: ["female"], interests: direct ? [] : ["Entrepreneurship"] }, ads: [{ localId: "ad_1", name: "Launch image", format: "image", assetIds: ["asset_image"], primaryText: "Your next campaign, ready for review.", headline: "Build your next launch", description: "One marketing workspace", callToAction: "learn_more", destinationUrl: "https://www.marpin.ai" }] }],
    ...(direct ? { metaDelivery: { version: 1 as const, pageId: "445566", pageName: "Marpin Official", placement: "facebook_feed" as const, specialAdCategory: "none" as const, beneficiary: "Marpin Company", payer: "Gabriel" } } : {}),
  };
  return { id: "meta_draft", platform: "meta_ads", connection: snapshot.connection, source: "manual", template: "meta_traffic", state: direct ? "ready" : "draft", snapshot, snapshotHash: HASH, version: 2, readyAt: direct ? NOW : null, createdAt: NOW, updatedAt: NOW, capabilities: capability(direct ? "ready" : "draft"), approvals: [], attempts: [], providerPausedConfirmation: null };
}

async function mockMeta(page: Page, options: { direct?: boolean; creation?: "success" | "uncertain" | "interrupted" | "prewrite_failure" } = {}) {
  let draft = initialDraft(options.direct !== false);
  let checkMode: "ready" | "denied" | "stale" | "billing" = "ready";
  let reconcileDenied = false;
  let publishingReads = 0;
  const calls: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  const completeSteps = [
    { key: "campaign", kind: "campaign" as const, status: "created" as const, id: "987654321" },
    { key: "image:ad_1", kind: "image" as const, status: "created" as const, id: "a".repeat(32) },
    { key: "adset:group_1", kind: "adset" as const, status: "created" as const, id: "987654322" },
    { key: "creative:ad_1", kind: "creative" as const, status: "created" as const, id: "987654323" },
    { key: "ad:ad_1", kind: "ad" as const, status: "created" as const, id: "987654324" },
  ];
  const complete = () => {
    const prior = draft.attempts[0];
    const attempt: PaidCampaignOperationAttemptDto = { ...prior, status: "succeeded", providerOutcome: { kind: "meta_paused_creation", providerSideEffect: "paused_objects", steps: completeSteps, campaignId: "987654321", verifiedAt: NOW, message: "Campaign, ad set and ads verified paused." } };
    draft = { ...draft, state: "provider_paused", version: draft.version + 1, attempts: [attempt], capabilities: capability("provider_paused"), providerPausedConfirmation: { providerCampaignId: "987654321", verificationStatus: "provider_verified", snapshotVersion: prior.snapshotVersion, snapshotHash: HASH, confirmedAt: NOW } };
    return attempt;
  };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const request = route.request();
    const path = url.pathname;
    const method = request.method();
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : {};
    calls.push({ path, method, body });
    if (path === "/api/brands") return json(route, { brands: [BRAND] });
    if (path === "/api/conversations") return json(route, { conversations: [] });
    if (path === "/api/billing") return json(route, { billing: { canManage: true, entitlements: { canUseOpus: false }, resources: { connections: 1 } } });
    if (path === "/api/connections") return json(route, { workspace: { name: "Solo Founder" }, accounts: [{ platform: "meta_ads", connectorPlatform: "meta_ads", name: "Meta Ads", connectionId: "connection_meta", status: "connected", externalAccountId: "123456789", displayName: "Founder Meta Account", currency: "EUR", timezone: "Europe/Madrid" }], connections: [] });
    if (path === "/api/assets") return json(route, { assets: [{ id: "asset_image", kind: "image", mimeType: "image/png", bytes: 100, filename: "launch.png", width: 1, height: 1, durationMs: null, source: "upload", contentUrl: "/api/assets/asset_image/content", createdAt: NOW }], capabilities: { imageGeneration: false } });
    if (path === "/api/assets/asset_image/content") return route.fulfill({ contentType: "image/png", body: PREVIEW_IMAGE });
    if (path.endsWith("/meta-publishing")) { publishingReads += 1; return json(route, { accountId: "123456789", currency: "EUR", timezone: "Europe/Madrid", canAdvertise: true, permissions: { adsManagement: true, pagesShowList: true, pagesReadEngagement: true }, pages: [{ id: "445566", name: "Marpin Official", canAdvertise: true }], pagesComplete: true }); }
    if (path === "/api/paid/drafts" && method === "GET") return json(route, { drafts: [draft] });
    if (path === "/api/paid/drafts/meta_draft" && method === "GET") return json(route, { draft });
    if (path === "/api/paid/drafts/meta_draft" && method === "PATCH") { draft = { ...draft, snapshot: body.snapshot as MetaCampaignSnapshotV1, version: draft.version + 1 }; return json(route, { draft }); }
    if (path.endsWith("/ready")) { draft = { ...draft, state: "ready", version: draft.version + 1, capabilities: capability("ready") }; return json(route, { draft }); }
    if (path.endsWith("/meta-check")) {
      if (checkMode === "billing") return json(route, { code: "plan_action_limit", message: "Your current plan does not include campaign execution.", actionUrl: "/settings/billing" }, 402);
      if (checkMode === "denied") return json(route, { message: "Meta Page advertising permission is missing." }, 403);
      return json(route, { ready: true, version: draft.version, snapshotHash: checkMode === "stale" ? "b".repeat(64) : draft.snapshotHash, checkedAt: NOW });
    }
    if (path.endsWith("/approvals")) {
      const approval = { id: `approval_meta_${draft.version}`, kind: "create_paused" as const, snapshotVersion: draft.version, snapshotHash: draft.snapshotHash, status: "approved" as const, approvedAt: NOW, consumedByAttemptId: null };
      draft = { ...draft, approvals: [approval, ...draft.approvals] };
      return json(route, { draft, approval, replayed: false });
    }
    if (path.endsWith("/operations")) {
      const attempt: PaidCampaignOperationAttemptDto = { id: "attempt_meta", approvalId: String(body.approvalId), operation: "create_paused", snapshotVersion: draft.version, snapshotHash: HASH, status: options.creation === "interrupted" ? "running" : "needs_reconciliation", capabilityReason: "provider_preflight_required", providerOutcome: { kind: "meta_paused_creation", providerSideEffect: "possible", steps: [completeSteps[0], { key: "image:ad_1", kind: "image", status: "submitting" }], campaignId: "987654321", code: "provider_timeout", message: "A submission may have completed. Inspect recorded objects before proceeding." }, attemptedAt: NOW };
      draft = { ...draft, state: options.creation === "interrupted" ? "creating_paused" : "needs_reconciliation", version: draft.version + 1, attempts: [attempt], approvals: draft.approvals.map((approval) => ({ ...approval, status: "consumed", consumedByAttemptId: attempt.id })), capabilities: capability("needs_reconciliation") };
      if (options.creation === "prewrite_failure") {
        const failed: PaidCampaignOperationAttemptDto = { ...attempt, status: "failed", providerOutcome: { kind: "meta_paused_creation", providerSideEffect: "none", steps: [], code: "permission_lost", message: "Publishing access changed before submission. No Meta changes were made." } };
        draft = { ...draft, state: "draft", capabilities: capability("draft"), attempts: [failed] };
        return json(route, { draft, attempt: failed, replayed: false });
      }
      if (options.creation === "interrupted") return route.abort("connectionreset");
      const returned = options.creation === "uncertain" ? attempt : complete();
      return json(route, { draft, attempt: returned, replayed: false });
    }
    if (path.endsWith("/meta-reconcile")) {
      if (reconcileDenied) return json(route, { message: "Meta cannot verify these objects with the current permissions." }, 403);
      const attempt = complete();
      return json(route, { draft, attempt, replayed: false });
    }
    return json(route, {});
  });
  return { calls, getDraft: () => draft, publishingReads: () => publishingReads, setCheckMode: (mode: typeof checkMode) => { checkMode = mode; }, setReconcileDenied: (value: boolean) => { reconcileDenied = value; } };
}

async function openDraft(page: Page) { await page.goto("/app?mode=paid&view=campaigns&paidView=drafts"); await expect(page.getByRole("heading", { name: "Campaign drafts", exact: true })).toBeVisible(); }
async function approveAndCreate(page: Page) {
  await page.getByRole("button", { name: "Check Meta readiness", exact: true }).click();
  await page.getByRole("button", { name: "Approve create paused", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Approve create paused", exact: true });
  await expect(dialog).toContainText("Marpin Official");
  await expect(dialog).toContainText("Facebook feed only");
  await expect(dialog).toContainText("Marpin Company");
  await expect(dialog).toContainText("Gabriel");
  await expect(dialog).toContainText("None, confirmed by the draft author");
  await dialog.getByRole("button", { name: "Approve exact snapshot", exact: true }).click();
  await page.getByRole("button", { name: "Create paused campaign", exact: true }).click();
}

test("Meta setup is explicit and does not rewrite existing targeting on enable or permission check", async ({ page }) => {
  const mock = await mockMeta(page, { direct: false });
  await openDraft(page);
  const toggle = page.getByRole("checkbox", { name: "Create through Marpin, in pause", exact: true });
  await expect(toggle).not.toBeChecked();
  expect(mock.publishingReads()).toBe(0);
  await toggle.check();
  let navigationConfirmed = false;
  page.once("dialog", async (dialog) => { navigationConfirmed = true; expect(dialog.message()).toContain("unsaved changes"); await dialog.dismiss(); });
  await page.getByRole("link", { name: "Grant publishing permissions", exact: true }).click();
  expect(navigationConfirmed).toBe(true);
  expect(mock.calls.some((call) => call.path === "/api/connect/meta_ads")).toBe(false);
  await expect(page.getByLabel("Ad group 1 locations", { exact: true })).toHaveValue("Spain");
  await expect(page.getByLabel("Ad group 1 languages", { exact: true })).toHaveValue("Spanish");
  await expect(page.getByLabel("Ad group 1 interests", { exact: true })).toHaveValue("Entrepreneurship");
  expect(mock.publishingReads()).toBe(0);
  await page.getByRole("button", { name: "Check Meta permissions", exact: true }).click();
  await page.getByLabel("Facebook Page", { exact: true }).selectOption("445566");
  expect(mock.publishingReads()).toBe(1);
  await expect(page.getByLabel("Ad group 1 locations", { exact: true })).toHaveValue("Spain");
  await page.getByLabel("Meta beneficiary", { exact: true }).fill("Marpin Company");
  await page.getByLabel("Meta payer", { exact: true }).fill("Gabriel");
  await page.getByLabel("Target Spain", { exact: true }).check();
  await expect(page.getByLabel("Ad group 1 locations", { exact: true })).toHaveValue("Spain\nES");
  await page.getByRole("button", { name: "Remove unresolved location Spain", exact: true }).click();
  await page.getByLabel("Apply broad audience targeting", { exact: true }).check();
  await expect(page.getByLabel("Ad group 1 languages", { exact: true })).toHaveValue("All languages");
  await expect(page.getByLabel("Ad group 1 interests", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Ad group 1 minimum age", { exact: true })).toHaveValue("25");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  expect(mock.calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
  await page.getByLabel("No Meta Special Ad Category", { exact: true }).check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => mock.calls.filter((call) => call.method === "PATCH").length).toBe(1);
  const saved = mock.getDraft().snapshot as MetaCampaignSnapshotV1;
  expect(saved.metaDelivery).toMatchObject({ pageId: "445566", pageName: "Marpin Official", beneficiary: "Marpin Company", payer: "Gabriel", placement: "facebook_feed", specialAdCategory: "none" });
  expect(saved.adGroups[0].targeting).toMatchObject({ locations: ["ES"], languages: ["All languages"], interests: [], ageMin: 25, ageMax: 55, genders: ["female"] });
  expect(mock.calls.some((call) => call.path.endsWith("/approvals") || call.path.endsWith("/operations"))).toBe(false);
});

test("readiness errors and stale hashes block approval; a matching check allows only exact paused creation", async ({ page }) => {
  const mock = await mockMeta(page);
  await openDraft(page);
  const approve = page.getByRole("button", { name: "Approve create paused", exact: true });
  await expect(approve).toBeDisabled();
  mock.setCheckMode("denied");
  await page.getByRole("button", { name: "Check Meta readiness", exact: true }).click();
  await expect(page.getByRole("region", { name: "Create in Meta, paused", exact: true }).getByRole("alert")).toContainText("Meta Page advertising permission is missing");
  await expect(approve).toBeDisabled();
  mock.setCheckMode("stale");
  await page.getByRole("button", { name: "Check Meta readiness", exact: true }).click();
  await expect(page.getByRole("region", { name: "Create in Meta, paused", exact: true }).getByRole("alert")).toContainText("The draft changed");
  await expect(approve).toBeDisabled();
  mock.setCheckMode("ready");
  await approveAndCreate(page);
  await expect(page.getByText("Verified paused", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve create paused", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View campaign in Meta", exact: true })).toHaveAttribute("href", "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123456789&selected_campaign_ids=987654321");
  expect(mock.getDraft().version).toBe(4);
  expect(mock.getDraft().attempts[0].snapshotVersion).toBe(2);
  expect(mock.calls.filter((call) => call.path.endsWith("/operations"))).toHaveLength(1);
  expect(mock.calls.filter((call) => call.path.endsWith("/approvals"))[0].body).toMatchObject({ kind: "create_paused", expectedVersion: 2, snapshotHash: HASH });
  expect(mock.calls.some((call) => call.body.operation === "activate" || call.body.kind === "activate")).toBe(false);
});

test("a billing gate offers the billing action without approving or submitting a Meta campaign", async ({ page }) => {
  const mock = await mockMeta(page);
  mock.setCheckMode("billing");
  await openDraft(page);
  await page.getByRole("button", { name: "Check Meta readiness", exact: true }).click();
  await expect(page.getByRole("region", { name: "Create in Meta, paused", exact: true }).getByRole("alert")).toContainText("Your current plan does not include campaign execution");
  await expect(page.getByRole("link", { name: "Review plan", exact: true })).toHaveAttribute("href", "/settings/billing");
  await expect(page.getByRole("button", { name: "Approve create paused", exact: true })).toBeDisabled();
  expect(mock.calls.some((call) => call.path.endsWith("/approvals") || call.path.endsWith("/operations"))).toBe(false);
});

test("a proven pre-write failure allows editing and fresh approval but never reuses the consumed approval", async ({ page }) => {
  const mock = await mockMeta(page, { creation: "prewrite_failure" });
  await openDraft(page);
  await approveAndCreate(page);
  await expect(page.getByText("Previous attempt: no provider changes", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check created objects", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create paused campaign", exact: true })).toHaveCount(0);
  expect(mock.getDraft().approvals[0].status).toBe("consumed");
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill("Corrected paused launch");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Mark ready", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve create paused", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Check Meta readiness", exact: true }).click();
  await page.getByRole("button", { name: "Approve create paused", exact: true }).click();
  await page.getByRole("dialog", { name: "Approve create paused", exact: true }).getByRole("button", { name: "Approve exact snapshot", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create paused campaign", exact: true })).toBeEnabled();
  expect(mock.calls.filter((call) => call.path.endsWith("/approvals"))).toHaveLength(2);
  expect(mock.calls.filter((call) => call.path.endsWith("/operations"))).toHaveLength(1);
  expect(mock.calls.filter((call) => call.path.endsWith("/approvals"))[1].body.expectedVersion).toBeGreaterThan(2);
});

test("uncertain creation exposes recorded steps and read-only reconciliation, never another creation", async ({ page }, testInfo) => {
  const mock = await mockMeta(page, { creation: "uncertain" });
  await openDraft(page);
  await approveAndCreate(page);
  const progress = page.getByLabel("Meta creation progress", { exact: true });
  await expect(progress).toContainText("Creation requires verification");
  await expect(progress).toContainText("No provider ID recorded");
  await expect(page.getByText("Verified paused", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve create paused", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create paused campaign", exact: true })).toHaveCount(0);
  mock.setReconcileDenied(true);
  await page.getByRole("button", { name: "Check created objects", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Meta cannot verify these objects" })).toBeVisible();
  await expect(page.getByText("Verified paused", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await page.locator("aside").filter({ has: page.getByRole("img", { name: "Marpin", exact: true }) }).boundingBox())?.width).toBe(64);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("meta-uncertain-mobile.png"), animations: "disabled" });
  mock.setReconcileDenied(false);
  await page.getByRole("button", { name: "Check created objects", exact: true }).click();
  await expect(page.getByText("Verified paused", { exact: true }).first()).toBeVisible();
  expect(mock.calls.filter((call) => call.path.endsWith("/operations"))).toHaveLength(1);
  expect(mock.calls.filter((call) => call.path.endsWith("/meta-reconcile"))).toHaveLength(2);
  expect(mock.calls.filter((call) => call.path.endsWith("/meta-reconcile")).every((call) => Object.keys(call.body).length === 0)).toBe(true);
});

test("an interrupted response reloads the durable attempt and offers reconciliation, not blind retry", async ({ page }) => {
  const mock = await mockMeta(page, { creation: "interrupted" });
  await openDraft(page);
  await approveAndCreate(page);
  await expect(page.getByRole("button", { name: "Check created objects", exact: true })).toBeVisible();
  await expect(page.getByLabel("Meta creation progress", { exact: true })).toContainText("Creation in progress, not yet verified");
  await expect(page.getByRole("button", { name: "Create paused campaign", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Check created objects", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve create paused", exact: true })).toHaveCount(0);
  expect(mock.calls.filter((call) => call.path.endsWith("/operations"))).toHaveLength(1);
});

test("normal desktop shows editor beside preview and mobile keeps the form first with draft history accessible", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockMeta(page, { direct: false });
  await openDraft(page);
  await expect(page.locator("#saved-paid-drafts")).toBeHidden();
  const campaignBox = await page.getByLabel("Campaign name", { exact: true }).boundingBox();
  const previewBox = await page.getByLabel("Live draft ad preview", { exact: true }).boundingBox();
  expect(campaignBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  expect(previewBox!.x).toBeGreaterThanOrEqual(campaignBox!.x + campaignBox!.width);
  await expect.poll(() => page.getByLabel("Live draft ad preview", { exact: true }).getByRole("img", { name: "launch.png" }).evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("meta-editor-app-desktop-1280.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Show saved campaign drafts", exact: true }).click();
  await expect(page.getByLabel("Search campaign drafts", { exact: true })).toBeVisible();
  await page.locator("#saved-paid-drafts").getByRole("button").filter({ hasText: "Marpin paused launch" }).click();
  await expect(page.locator("#saved-paid-drafts")).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByLabel("Campaign name", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Live draft ad preview", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("meta-editor-app-mobile-390.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Show ad preview", exact: true }).click();
  await expect(page.getByLabel("Live draft ad preview", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hide ad preview", exact: true }).click();
  await expect(page.getByLabel("Campaign name", { exact: true })).toBeVisible();
});
