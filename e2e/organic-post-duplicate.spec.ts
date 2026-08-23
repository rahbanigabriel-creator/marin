import { expect, test, type Page, type Route } from "@playwright/test";

const TIMEZONE = "Europe/Madrid";
const NOW = "2026-08-22T10:00:00.000Z";

const BRAND = {
  id: "brand_duplicate",
  name: "Marpin",
  websiteUrl: "https://www.marpin.ai",
  isPrimary: true,
  summary: "Distribution software for founders",
  audience: ["Founders"],
  voice: ["Direct"],
  offers: ["Marketing operating system"],
  competitors: [],
  proofPoints: [],
  visualStyle: [],
  locale: "en-GB",
  timezone: TIMEZONE,
  currency: "EUR",
  contextVersion: 1,
  auditSnapshot: null,
  auditedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

function madridDateKey(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockWorkspace(page: Page, canManage = true): Promise<void> {
  await page.route(/\/api\/connections(?:\?.*)?$/, (route) =>
    json(route, { workspace: { name: "Duplicate test" }, connections: [] }),
  );
  await page.route(/\/api\/brands(?:\?.*)?$/, (route) => json(route, { brands: [BRAND] }));
  await page.route(/\/api\/conversations(?:\?.*)?$/, (route) => json(route, { conversations: [] }));
  await page.route(/\/api\/billing(?:\?.*)?$/, (route) =>
    json(route, {
      billing: {
        canManage,
        entitlements: { canUseOpus: false },
        resources: { connections: 0 },
      },
    }),
  );
}

test("a duplicate retry reuses one durable request and cannot create a second post", async ({ page }) => {
  await mockWorkspace(page);
  const scheduledAt = `${madridDateKey()}T09:30:00+02:00`;
  const original = {
    id: "item_original",
    planId: "plan_original",
    title: "Founder distribution lesson",
    coreCopy: "Build distribution before launch day.",
    status: "draft",
    version: 1,
  };
  const originalPublication = {
    id: "publication_original",
    contentItemId: original.id,
    platform: "instagram",
    format: "reel",
    status: "draft",
    title: original.title,
    body: original.coreCopy,
    scheduledAt,
  };
  let duplicated: { contentItem: typeof original; publication: typeof originalPublication } | null = null;
  const requestIds: string[] = [];
  let createCount = 0;
  let attempts = 0;

  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    json(route, {
      calendar: {
        timezone: TIMEZONE,
        plans: [],
        contentItems: [original, ...(duplicated ? [duplicated.contentItem] : [])],
        publications: [originalPublication, ...(duplicated ? [duplicated.publication] : [])],
      },
    }),
  );
  await page.route(/\/api\/content\/posts$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, string | null>;
    attempts += 1;
    requestIds.push(String(body.requestId));
    expect(body.sourceContentItemId).toBe(original.id);
    expect(body.planId).toBe("plan_original");
    expect(body.platform).toBe("instagram");
    expect(body.format).toBe("reel");
    expect(body.coreCopy).toBe(original.coreCopy);
    expect(new Date(String(body.scheduledAt)).getTime()).toBe(new Date(scheduledAt).getTime());

    if (!duplicated) {
      createCount += 1;
      duplicated = {
        contentItem: {
          ...original,
          id: "item_duplicate",
          title: String(body.title),
          version: 1,
        },
        publication: {
          ...originalPublication,
          id: "publication_duplicate",
          contentItemId: "item_duplicate",
          title: String(body.title),
        },
      };
      await route.abort("failed");
      return;
    }

    await json(route, { post: duplicated }, 201);
  });

  await page.goto("/app?mode=organic&view=calendar");
  const edit = page.getByRole("button", { name: "Edit Founder distribution lesson on Instagram" });
  await expect(edit).toBeVisible();
  await edit.click();
  const editor = page.getByRole("dialog", { name: "Edit post" });
  await editor.getByRole("button", { name: "Duplicate post" }).click();

  const duplicateDialog = page.getByRole("dialog", { name: "Duplicate post" });
  await expect(duplicateDialog.getByLabel("Title")).toHaveValue("Copy of Founder distribution lesson");
  await duplicateDialog.getByRole("button", { name: "Duplicate post" }).click();
  await expect(duplicateDialog.getByRole("alert")).toBeVisible();
  await duplicateDialog.getByRole("button", { name: "Duplicate post" }).click();

  await expect(
    page.getByRole("button", { name: "Edit Copy of Founder distribution lesson on Instagram" }),
  ).toBeVisible();
  expect(attempts).toBe(2);
  expect(createCount).toBe(1);
  expect(requestIds[0]).toBe(requestIds[1]);
});

test("members can inspect a post without a duplicate action", async ({ page }) => {
  await mockWorkspace(page, false);
  const scheduledAt = `${madridDateKey()}T09:30:00+02:00`;
  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    json(route, {
      calendar: {
        timezone: TIMEZONE,
        plans: [],
        contentItems: [{
          id: "item_member",
          planId: null,
          title: "Read-only lesson",
          coreCopy: "Inspect but do not change this.",
          status: "draft",
          version: 1,
        }],
        publications: [{
          id: "publication_member",
          contentItemId: "item_member",
          platform: "instagram",
          format: "post",
          status: "draft",
          title: "Read-only lesson",
          body: "Inspect but do not change this.",
          scheduledAt,
        }],
      },
    }),
  );

  await page.goto("/app?mode=organic&view=calendar");
  await page.getByRole("button", { name: "Edit Read-only lesson on Instagram" }).click();
  const editor = page.getByRole("dialog", { name: "Edit post" });
  await expect(editor.getByRole("button", { name: "Duplicate post" })).toHaveCount(0);
  await expect(editor.getByLabel("Title")).toBeDisabled();
});
