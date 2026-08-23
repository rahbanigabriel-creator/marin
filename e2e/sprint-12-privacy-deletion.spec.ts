import { expect, test, type Page, type Route } from "@playwright/test";

import type { DeletionRequestView } from "../src/lib/privacy/deletion/types";

test.setTimeout(180_000);

const NOW = "2026-08-21T12:00:00.000Z";

function deletion(
  status: DeletionRequestView["status"],
  overrides: Partial<DeletionRequestView> = {},
): DeletionRequestView {
  return {
    id: "deletion_request_1",
    status,
    stage: status === "queued" ? "dispatch" : status === "processing" ? "assets" : "provider_revocation",
    dispatchStatus: status === "queued" ? "sent" : "sent",
    stripeStatus: status === "queued" ? "pending" : "confirmed",
    blobStatus: status === "processing" ? "pending" : status === "queued" ? "pending" : "confirmed",
    providerOutcomes: [],
    warningCodes: [],
    failureCode: null,
    failureMessage: null,
    clerkStatus: "pending",
    attempt: 1,
    version: 1,
    requestedAt: NOW,
    processingStartedAt: status === "queued" ? null : NOW,
    completedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockDeletionApi(page: Page, role: "owner" | "member" = "owner") {
  let current: DeletionRequestView | null = null;
  let detailReads = 0;
  const mutations: Array<{ path: string; body: Record<string, unknown> }> = [];

  await page.route(/\/api\/settings\/deletion(?:\/.*)?$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === "/api/settings/deletion" && method === "GET") {
      await json(route, current
        ? { deletion: current, confirmationPhrase: null, role: null, canDelete: true }
        : { deletion: null, confirmationPhrase: "DELETE user-founder", role, canDelete: role === "owner" });
      return;
    }

    if (url.pathname === "/api/settings/deletion" && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      mutations.push({ path: url.pathname, body });
      expect(body.confirmation).toBe("DELETE user-founder");
      expect(body.requestId).toMatch(/^create:[0-9a-f-]{36}$/);
      current = deletion("queued");
      await json(route, { deletion: current, replayed: false }, 201);
      return;
    }

    if (url.pathname.endsWith("/retry") && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      mutations.push({ path: url.pathname, body });
      expect(body.requestId).toMatch(/^retry:[0-9a-f-]{36}$/);
      current = deletion("processing", { attempt: 2, version: 3 });
      detailReads = 1;
      await json(route, { deletion: current, replayed: false }, 202);
      return;
    }

    if (url.pathname === "/api/settings/deletion/deletion_request_1" && method === "GET") {
      detailReads += 1;
      if (detailReads === 1) {
        current = deletion("needs_attention", {
          failureCode: "provider_revocation_failed",
          failureMessage: "A required external cleanup step did not complete.",
          providerOutcomes: [{ provider: "google", status: "failed" }],
          attempt: 1,
          version: 2,
        });
      } else {
        current = deletion("completed_with_warnings", {
          stage: "completed",
          stripeStatus: "confirmed",
          blobStatus: "confirmed",
          providerOutcomes: [{ provider: "google", status: "failed" }],
          warningCodes: ["google_revocation_failed"],
          clerkStatus: "confirmed",
          attempt: 2,
          version: 4,
          completedAt: NOW,
        });
      }
      await json(route, { deletion: current });
      return;
    }

    await json(route, { error: "not_found" }, 404);
  });

  return { mutations };
}

test("an owner confirms, follows, retries, and completes durable workspace deletion", async ({ page }) => {
  const mock = await mockDeletionApi(page);
  await page.goto("/settings/data");

  await expect(page.getByRole("heading", { name: "Data & privacy" })).toBeVisible();
  await expect(page.getByText("agent runs", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Delete workspace" }).click();

  const dialog = page.getByRole("dialog", { name: "Delete this workspace" });
  const confirm = dialog.getByRole("button", { name: "Permanently delete workspace" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Type DELETE user-founder/).fill("DELETE user-founder ");
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Type DELETE user-founder/).fill("DELETE user-founder");
  await confirm.click();

  await expect(page.getByRole("heading", { name: "Queued" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Marpin" })).toHaveAttribute("href", "/");
  expect(mock.mutations).toHaveLength(1);

  await page.getByRole("button", { name: "Refresh deletion status" }).click();
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.getByText("Google needs manual review")).toBeVisible();
  await page.getByRole("button", { name: "Retry cleanup" }).click();
  await expect(page.getByRole("heading", { name: "Deleting workspace" })).toBeVisible();

  await page.getByRole("button", { name: "Refresh deletion status" }).click();
  await expect(page.getByRole("heading", { name: "Deleted with follow-up needed" })).toBeVisible();
  await expect(page.getByText(/Remove Marpin from your Google Account connections/)).toBeVisible();
  expect(mock.mutations).toHaveLength(2);
});

test("a member sees owner-only deletion without destructive controls on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDeletionApi(page, "member");
  await page.goto("/settings/data");

  await expect(page.getByText(/Only the workspace owner can request/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete workspace" })).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveJSProperty("scrollWidth", 0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("the public deletion policy points signed-in users to the in-app workflow", async ({ page }) => {
  await page.goto("/data-deletion");
  await expect(page.getByText(/Settings.*Data & privacy/)).toBeVisible();
  await expect(page.getByText(/follow its saved status/)).toBeVisible();
});
