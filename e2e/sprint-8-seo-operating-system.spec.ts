import { expect, test, type Page, type Route } from "@playwright/test";

import type {
  SeoProposal,
  SeoTask,
  SeoWorkspaceResponse,
} from "../src/components/seo/types";
import { SeoValidationError } from "../src/lib/seo/errors";
import {
  parseCreateSeoTaskBody,
  parsePatchSeoTaskBody,
} from "../src/lib/seo/validation";

test.setTimeout(150_000);

const NOW = "2026-07-21T09:30:00.000Z";
const BRAND = {
  id: "brand_sprint8",
  name: "Marpin",
  websiteUrl: "https://www.marpin.ai",
  isPrimary: true,
  summary: "Distribution software for solo founders",
  audience: ["Solo software founders"],
  voice: ["Direct", "Practical"],
  offers: ["A marketing operating system"],
  competitors: [],
  proofPoints: [],
  visualStyle: [],
  locale: "en-GB",
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

async function mockShell(page: Page, canManage: boolean): Promise<void> {
  await page.route(/\/api\/connections(?:\?.*)?$/, (route) =>
    json(route, { workspace: { name: "Solo Founder" }, connections: [] }),
  );
  await page.route(/\/api\/brands(?:\?.*)?$/, (route) => json(route, { brands: [BRAND] }));
  await page.route(/\/api\/conversations(?:\?.*)?$/, (route) =>
    json(route, { conversations: [] }),
  );
  await page.route(/\/api\/billing(?:\?.*)?$/, (route) =>
    json(route, {
      billing: {
        canManage,
        entitlements: { canUseOpus: false },
        resources: { connections: 0 },
      },
    }),
  );
  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    json(route, { calendar: { timezone: "Europe/Madrid", plans: [], contentItems: [], publications: [] } }),
  );
}

function initialTasks(): SeoTask[] {
  return [
    {
      id: "task_canonical",
      source: "crawl",
      category: "Technical",
      severity: "critical",
      priority: 1,
      title: "Restore canonical tags on pricing pages",
      description: "Twelve pricing variants expose duplicate indexable URLs without canonical tags.",
      recommendedFix: "Add a self-referencing canonical to each primary pricing URL and review parameter handling.",
      status: "open",
      verificationStatus: "unverified",
      evidence: [
        {
          source: "crawl",
          label: "Pages missing canonical",
          value: "12 URLs",
          observedFrom: "2026-07-21T08:00:00.000Z",
          observedTo: "2026-07-21T08:12:00.000Z",
        },
      ],
      completionNote: null,
      completedAt: null,
      version: 2,
      updatedAt: "2026-07-21T08:15:00.000Z",
    },
    {
      id: "task_clicks",
      source: "search_console",
      category: "Content",
      severity: "high",
      priority: 2,
      title: "Recover declining comparison-page clicks",
      description: "Non-brand clicks to comparison pages declined while impressions remained stable.",
      recommendedFix: "Review title intent and update the two pages losing the most clicks.",
      status: "in_progress",
      verificationStatus: "unverified",
      evidence: [
        {
          source: "search_console",
          label: "Clicks vs prior period",
          value: "-31% across 2 pages",
          observedFrom: "2026-06-23T00:00:00.000Z",
          observedTo: "2026-07-20T23:59:59.000Z",
        },
      ],
      completionNote: null,
      completedAt: null,
      version: 7,
      updatedAt: "2026-07-21T08:20:00.000Z",
    },
    {
      id: "task_engagement",
      source: "ga4",
      category: "Engagement",
      severity: "medium",
      priority: 3,
      title: "Improve organic landing-page engagement",
      description: "Organic visitors leave the integration directory before opening a provider page.",
      recommendedFix: "Clarify provider categories and add direct links to the highest-demand integrations.",
      status: "open",
      verificationStatus: "unverified",
      evidence: [
        {
          source: "ga4",
          label: "Engagement rate",
          value: "38.4% from organic sessions",
          observedFrom: "2026-06-23T00:00:00.000Z",
          observedTo: "2026-07-20T23:59:59.000Z",
        },
      ],
      completionNote: null,
      completedAt: null,
      version: 1,
      updatedAt: "2026-07-21T08:25:00.000Z",
    },
    {
      id: "task_history",
      source: "manual",
      category: "Content",
      severity: "low",
      priority: 8,
      title: "Refresh the founder story metadata",
      description: "Track the editorial metadata review in the same SEO history.",
      recommendedFix: "Compare the current description with the page promise.",
      status: "completed",
      verificationStatus: "unverified",
      evidence: [],
      completionNote: "Metadata reviewed with the founder.",
      completedAt: "2026-07-19T10:00:00.000Z",
      version: 3,
      updatedAt: "2026-07-19T10:00:00.000Z",
    },
  ];
}

function workspace(tasks: SeoTask[], canManage: boolean): SeoWorkspaceResponse {
  return {
    brand: {
      id: BRAND.id,
      name: BRAND.name,
      websiteUrl: BRAND.websiteUrl,
      auditedAt: NOW,
    },
    sources: [
      {
        id: "crawl",
        label: "Website crawl",
        state: "available",
        detail: "184 pages inspected",
        observedFrom: "2026-07-21T08:00:00.000Z",
        observedTo: "2026-07-21T08:12:00.000Z",
        rowCount: 184,
      },
      {
        id: "search_console",
        label: "Search Console",
        state: "available",
        detail: "Query and landing-page performance",
        observedFrom: "2026-06-23T00:00:00.000Z",
        observedTo: "2026-07-20T23:59:59.000Z",
        rowCount: 642,
      },
      {
        id: "ga4",
        label: "Google Analytics 4",
        state: "available",
        detail: "Organic sessions and engagement",
        observedFrom: "2026-06-23T00:00:00.000Z",
        observedTo: "2026-07-20T23:59:59.000Z",
        rowCount: 318,
      },
    ],
    tasks,
    capability: { canManage },
  };
}

test("an owner runs sourced analysis and manages SEO work without fake execution claims", async ({ page }) => {
  await mockShell(page, true);
  let tasks = initialTasks();
  let analysisCalls = 0;
  let staleConflict = true;
  let manualCreateCalls = 0;
  let manualRequestId: string | null = null;
  let persistedManualTask: SeoTask | null = null;
  let proposal: SeoProposal = {
    id: "proposal_canonical",
    taskId: "task_canonical",
    fields: {
      recommendedFix: "Add self-referencing canonicals to the 12 primary pricing URLs, then compare a fresh crawl before closing the task.",
    },
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    status: "proposed",
    createdAt: NOW,
  };

  await page.route(/\/api\/seo\?brandId=.*/, (route) => json(route, workspace(tasks, true)));
  await page.route(/\/api\/seo\/analyze$/, async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ brandId: BRAND.id });
    analysisCalls += 1;
    await json(route, { accepted: true }, 202);
  });
  await page.route(/\/api\/seo\/tasks$/, async (route) => {
    let body: ReturnType<typeof parseCreateSeoTaskBody>;
    try {
      body = parseCreateSeoTaskBody(route.request().postDataJSON());
    } catch (error) {
      if (!(error instanceof SeoValidationError)) throw error;
      await json(route, { code: error.code, message: error.message }, 422);
      return;
    }
    expect(body.brandId).toBe(BRAND.id);
    manualCreateCalls += 1;
    if (!persistedManualTask) {
      manualRequestId = body.requestId;
      persistedManualTask = {
        id: "task_manual",
        source: "manual",
        category: "Manual",
        severity: "medium",
        priority: 9,
        title: body.title,
        description: body.description ?? "",
        recommendedFix: body.recommendedFix ?? "",
        status: "open",
        verificationStatus: "unverified",
        evidence: [],
        completionNote: null,
        completedAt: null,
        version: 1,
        updatedAt: NOW,
      };
      tasks = [...tasks, persistedManualTask];
      await route.abort("connectionfailed");
      return;
    }
    expect(body.requestId).toBe(manualRequestId);
    expect(body.title).toBe(persistedManualTask.title);
    await json(route, { task: persistedManualTask }, 200);
  });
  await page.route(/\/api\/seo\/tasks\/task_canonical\/proposals$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const current = tasks.find((task) => task.id === "task_canonical");
    expect(body.expectedVersion).toBe(current?.version);
    expect(typeof body.requestId).toBe("string");
    expect(String(body.requestId).length).toBeGreaterThanOrEqual(10);
    await json(route, { proposal, reused: false, credits: 1 }, 201);
  });
  await page.route(/\/api\/seo\/tasks\/task_canonical\/proposals\/proposal_canonical\/accept$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const current = tasks.find((task) => task.id === "task_canonical");
    expect(body.expectedVersion).toBe(current?.version);
    if (!current) throw new Error("Expected canonical task");
    const updated = {
      ...current,
      recommendedFix: proposal.fields.recommendedFix,
      version: current.version + 1,
      updatedAt: NOW,
    };
    tasks = tasks.map((task) => task.id === updated.id ? updated : task);
    proposal = { ...proposal, status: "accepted" };
    await json(route, { task: updated, proposal, reused: false });
  });
  await page.route(/\/api\/seo\/tasks\/[^/]+$/, async (route) => {
    expect(route.request().method()).toBe("PATCH");
    const id = new URL(route.request().url()).pathname.split("/").pop();
    const current = tasks.find((task) => task.id === id);
    if (!current) {
      await json(route, { message: "Task not found" }, 404);
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    try {
      parsePatchSeoTaskBody(body);
    } catch (error) {
      if (!(error instanceof SeoValidationError)) throw error;
      await json(route, { code: error.code, message: error.message }, 422);
      return;
    }
    if (id === "task_clicks" && staleConflict) {
      expect(body.expectedVersion).toBe(7);
      staleConflict = false;
      const latest = {
        ...current,
        description: "A teammate narrowed the decline to the two highest-impression comparison pages.",
        version: 8,
        updatedAt: "2026-07-21T09:15:00.000Z",
      };
      tasks = tasks.map((task) => task.id === latest.id ? latest : task);
      await json(route, { code: "version_conflict", message: "This task changed elsewhere. Reload the latest version." }, 409);
      return;
    }
    if (body.status !== "completed") expect(body).not.toHaveProperty("completionNote");
    expect(body.expectedVersion).toBe(current.version);
    const status = typeof body.status === "string" ? body.status as SeoTask["status"] : current.status;
    const updated: SeoTask = {
      ...current,
      ...body,
      id: current.id,
      source: current.source,
      evidence: current.evidence,
      verificationStatus: "unverified",
      completionNote: body.completionNote === undefined ? current.completionNote : body.completionNote as string | null,
      completedAt: status === "completed"
        ? current.status === "completed" ? current.completedAt : NOW
        : status === current.status ? current.completedAt : null,
      status,
      version: current.version + 1,
      updatedAt: NOW,
    };
    tasks = tasks.map((task) => task.id === updated.id ? updated : task);
    await json(route, { task: updated });
  });

  await page.goto("/app?mode=organic&view=calendar&organicView=seo");
  await expect(page.getByRole("heading", { name: "SEO workspace" })).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=seo(?:&|$)/);
  await expect(page).not.toHaveURL(/organicView=/);

  await page.getByRole("button", { name: "Run analysis" }).click();
  await expect.poll(() => analysisCalls).toBe(1);
  const coverage = page.getByRole("region", { name: "Source coverage" });
  await expect(coverage.getByText("Website crawl", { exact: true })).toBeVisible();
  await expect(coverage.getByText("Search Console", { exact: true })).toBeVisible();
  await expect(coverage.getByText("Google Analytics 4", { exact: true })).toBeVisible();
  await expect(coverage.getByText("184 rows", { exact: false })).toBeVisible();
  await expect(coverage.getByText("642 rows", { exact: false })).toBeVisible();
  await expect(coverage.getByText("318 rows", { exact: false })).toBeVisible();

  const canonicalRow = page.getByRole("article").filter({ has: page.getByRole("button", { name: "Open Restore canonical tags on pricing pages" }) });
  await canonicalRow.getByText("Evidence (1)", { exact: true }).click();
  await expect(canonicalRow.getByText("Pages missing canonical:", { exact: false })).toBeVisible();
  await expect(canonicalRow.getByText("12 URLs", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Add manual task" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Review sitemap exclusions");
  await page.getByLabel("Description", { exact: true }).fill("Check whether intentionally excluded docs still belong outside the sitemap.");
  await page.getByLabel("Recommended fix optional", { exact: true }).fill("Compare excluded docs with the current information architecture.");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("region", { name: "SEO workspace" }).getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("button", { name: "Open Review sitemap exclusions" })).toBeVisible();
  expect(manualCreateCalls).toBe(2);
  expect(tasks.filter((task) => task.id === "task_manual")).toHaveLength(1);

  const invalidPatch = await page.evaluate(async () => {
    const response = await fetch("/api/seo/tasks/task_canonical", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: 2, completionNote: null }),
    });
    return { status: response.status, body: await response.json() as { code?: string } };
  });
  expect(invalidPatch).toEqual({
    status: 422,
    body: { code: "completion_status_required", message: "completionNote can only be set while marking the task completed" },
  });

  await page.getByRole("button", { name: "Open Restore canonical tags on pricing pages" }).click();
  let dialog = page.getByRole("dialog", { name: "Restore canonical tags on pricing pages" });
  await expect(dialog.getByRole("button", { name: "Close SEO task" })).toBeFocused();
  await dialog.getByLabel("Description").fill("Twelve pricing variants expose duplicate indexable URLs and split ranking signals.");
  await dialog.getByLabel("Priority").fill("4");
  await dialog.getByRole("button", { name: "Save task" }).click();
  await expect(dialog.getByLabel("Description")).toHaveValue("Twelve pricing variants expose duplicate indexable URLs and split ranking signals.");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await page.reload();
  await expect(page).toHaveURL(/[?&]view=seo(?:&|$)/);
  await expect(page).not.toHaveURL(/organicView=/);
  await expect(page.getByRole("heading", { name: "SEO workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Open Restore canonical tags on pricing pages" }).click();
  dialog = page.getByRole("dialog", { name: "Restore canonical tags on pricing pages" });
  await expect(dialog.getByLabel("Description")).toHaveValue("Twelve pricing variants expose duplicate indexable URLs and split ranking signals.");
  await expect(dialog.getByLabel("Priority")).toHaveValue("4");

  const manualFix = await dialog.getByLabel("Recommended fix").inputValue();
  await dialog.getByLabel("Guidance for AI (optional)").fill("Keep the recommendation measurable and limited to canonical tags.");
  await dialog.getByRole("button", { name: "Ask AI for fix" }).click();
  await expect(dialog.getByText("Proposal preview", { exact: true })).toBeVisible();
  await expect(dialog.getByText(proposal.fields.recommendedFix, { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Recommended fix")).toHaveValue(manualFix);
  await dialog.getByRole("button", { name: "Accept AI fix" }).click();
  await expect(dialog.getByRole("button", { name: "Accepted" })).toBeVisible();
  await expect(dialog.getByLabel("Recommended fix")).toHaveValue(proposal.fields.recommendedFix);

  await dialog.getByRole("button", { name: "Mark complete" }).click();
  await expect(dialog.getByText("Tracked as complete in Marpin. Website change not verified.", { exact: true })).toBeVisible();
  await dialog.getByLabel("Completion note (optional)").fill("Canonical templates reviewed in the CMS change set.");
  await dialog.getByRole("button", { name: "Confirm completion" }).click();
  await expect(dialog.getByText("Tracked as complete in Marpin. Website change not verified.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(canonicalRow.getByText("Tracked as complete in Marpin. Website change not verified.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open Recover declining comparison-page clicks" }).click();
  dialog = page.getByRole("dialog", { name: "Recover declining comparison-page clicks" });
  await dialog.getByLabel("Description").fill("A local draft that is now stale.");
  await dialog.getByRole("button", { name: "Save task" }).click();
  await expect(dialog.getByRole("alert")).toContainText("changed elsewhere");
  await dialog.getByRole("button", { name: "Reload latest" }).click();
  await expect(dialog.getByLabel("Description")).toHaveValue("A teammate narrowed the decline to the two highest-impression comparison pages.");
  await dialog.getByLabel("Description").fill("Review the two highest-impression comparison pages first.");
  await dialog.getByRole("button", { name: "Save task" }).click();
  await expect(dialog.getByLabel("Description")).toHaveValue("Review the two highest-impression comparison pages first.");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByLabel("Filter task status").selectOption("completed");
  await expect(page.getByRole("button", { name: "Open Restore canonical tags on pricing pages" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Refresh the founder story metadata" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Recover declining comparison-page clicks" })).toHaveCount(0);
});

test("a mobile member can inspect sourced SEO history but cannot mutate it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShell(page, false);
  const tasks = initialTasks();
  const memberWorkspace = workspace(tasks, false);
  memberWorkspace.sources[2] = {
    id: "ga4",
    label: "Google Analytics 4",
    state: "unavailable",
    detail: "Connect GA4 to include engagement evidence",
    observedFrom: null,
    observedTo: null,
    rowCount: null,
  };
  await page.route(/\/api\/seo\?brandId=.*/, (route) => json(route, memberWorkspace));

  await page.goto("/app?mode=organic&view=calendar&organicView=seo");
  await expect(page.getByRole("heading", { name: "SEO workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run analysis" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add manual task" })).toHaveCount(0);
  const coverage = page.getByRole("region", { name: "Source coverage" });
  await expect(coverage.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(coverage.getByText("No observation window", { exact: false })).toBeVisible();
  await expect(coverage.getByText("0 rows", { exact: false })).toHaveCount(0);

  const trigger = page.getByRole("button", { name: "Open Refresh the founder story metadata" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Refresh the founder story metadata" });
  await expect(dialog.getByRole("button", { name: "Close SEO task" })).toBeFocused();
  await expect(dialog.getByText("Read-only access. Owners and admins can update this task.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save task" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Ask AI for fix" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Mark complete" })).toHaveCount(0);
  await expect(dialog.getByText("Tracked as complete in Marpin. Website change not verified.", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.reload();
  await expect(page).toHaveURL(/[?&]view=seo(?:&|$)/);
  await expect(page).not.toHaveURL(/organicView=/);
  await expect(page.getByRole("heading", { name: "SEO workspace" })).toBeVisible();
});
