import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

const BRAND = {
  id: "brand_calendar",
  name: "Marpin",
  websiteUrl: "https://www.marpin.ai",
  isPrimary: true,
  summary: "AI distribution workspace",
  audience: ["Solo software founders"],
  voice: ["Practical", "Direct"],
  offers: ["Marketing operating system"],
  competitors: [],
  proofPoints: [],
  visualStyle: [],
  locale: "en-GB",
  timezone: "Europe/Madrid",
  currency: "EUR",
  contextVersion: 1,
  auditSnapshot: null,
  auditedAt: "2026-07-20T00:00:00.000Z",
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
};

function madridDateKey(offsetDays = 0): string {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offsetDays);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function mockWorkspace(page: Page): Promise<void> {
  await page.route(/\/api\/connections(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ workspace: { name: "Solo Founder" }, connections: [] }),
    }),
  );
  await page.route(/\/api\/brands(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ brands: [BRAND] }),
    }),
  );
  await page.route(/\/api\/conversations(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ conversations: [] }),
    }),
  );
  await page.route(/\/api\/billing(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        billing: {
          canManage: true,
          entitlements: { canUseOpus: false },
          resources: { connections: 0 },
        },
      }),
    }),
  );
}

test("manual organic posts persist, edit atomically, and survive reload", async ({ page }) => {
  await mockWorkspace(page);
  let contentVersion = 0;
  let createdPlan: {
    id: string;
    version: number;
    name: string;
    objective: string | null;
    status: "draft";
    period: "week" | "month";
    startDate: string;
    endDate: string;
    timezone: string;
  } | null = null;
  let saved: {
    publicationId: string;
    title: string;
    copy: string;
    platform: string;
    format: string;
    status: string;
    scheduledAt: string;
  } | null = null;

  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        calendar: {
          start: route.request().url(),
          end: route.request().url(),
          timezone: "Europe/Madrid",
          plans: createdPlan ? [createdPlan] : [],
          contentItems: saved
            ? [
                {
                  id: "item_calendar",
                  planId: "plan_calendar",
                  title: saved.title,
                  coreCopy: saved.copy,
                  status: saved.status === "ready" ? "review" : "draft",
                  version: contentVersion,
                },
              ]
            : [],
          publications: saved
            ? [
                {
                  id: saved.publicationId,
                  contentItemId: "item_calendar",
                  platform: saved.platform,
                  format: saved.format,
                  status: saved.status,
                  title: saved.title,
                  body: saved.copy,
                  scheduledAt: saved.scheduledAt,
                },
              ]
            : [],
        },
      }),
    }),
  );

  await page.route(/\/api\/content\/plans$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, string | null>;
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    createdPlan = {
      id: "plan_calendar",
      version: 1,
      name: String(body.name),
      objective: body.objective,
      status: "draft",
      period: body.period as "week" | "month",
      startDate: new Date(String(body.startDate)).toISOString(),
      endDate: new Date(String(body.endDate)).toISOString(),
      timezone: String(body.timezone),
    };
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ plan: createdPlan }),
    });
  });

  await page.route(/\/api\/content\/posts$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, string>;
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.planId).toBe("plan_calendar");
    contentVersion = 1;
    saved = {
      publicationId: "pub_calendar",
      title: body.title,
      copy: body.coreCopy,
      platform: body.platform,
      format: body.format,
      status: body.status,
      scheduledAt: new Date(body.scheduledAt).toISOString(),
    };
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        post: {
          contentItem: {
            id: "item_calendar",
            planId: "plan_calendar",
            title: saved.title,
            coreCopy: saved.copy,
            status: "draft",
            version: contentVersion,
          },
          publication: {
            id: saved.publicationId,
            contentItemId: "item_calendar",
            ...saved,
          },
        },
      }),
    });
  });

  await page.route(/\/api\/content\/variants\/pub_calendar$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, string | number>;
    expect(body.expectedVersion).toBe(contentVersion);
    contentVersion += 1;
    if (!saved) throw new Error("Expected a saved post");
    saved = {
      ...saved,
      title: typeof body.title === "string" ? body.title : saved.title,
      copy: typeof body.body === "string" ? body.body : saved.copy,
      status: typeof body.status === "string" ? body.status : saved.status,
      scheduledAt:
        typeof body.scheduledAt === "string"
          ? new Date(body.scheduledAt).toISOString()
          : saved.scheduledAt,
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        post: {
          contentItem: {
            id: "item_calendar",
            planId: "plan_calendar",
            title: saved.title,
            coreCopy: saved.copy,
            status: saved.status === "ready" ? "review" : "draft",
            version: contentVersion,
          },
          publication: {
            id: saved.publicationId,
            contentItemId: "item_calendar",
            platform: saved.platform,
            format: saved.format,
            status: saved.status,
            title: saved.title,
            body: saved.copy,
            scheduledAt: saved.scheduledAt,
          },
        },
      }),
    });
  });

  await page.goto("/app?mode=organic&view=calendar");
  await expect(page.getByRole("heading", { name: "Content planner" })).toBeVisible();
  await page.getByRole("button", { name: "New plan" }).click();
  const planDialog = page.getByRole("dialog", { name: "New content plan" });
  await planDialog.getByLabel("Plan name").fill("Founder launch week");
  await planDialog.getByLabel("Objective").fill("Build a repeatable launch rhythm");
  await planDialog.getByRole("button", { name: "Create plan" }).click();
  await expect(page.getByLabel("Content plan", { exact: true })).toHaveValue("plan_calendar");
  await page.getByRole("button", { name: "Add post" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add post" });
  await dialog.getByLabel("Title").fill("Founder launch lesson");
  await dialog.getByLabel(/Copy/).fill("Distribution starts before launch day.");
  await dialog.getByLabel("Platform").selectOption("instagram");
  await dialog.getByLabel("Format").selectOption("reel");
  await dialog.getByLabel("Date").fill(madridDateKey(1));
  await dialog.getByLabel("Time").fill("09:30");
  await dialog.getByRole("button", { name: "Add to plan" }).click();

  const edit = page.getByRole("button", {
    name: "Edit Founder launch lesson on Instagram",
  });
  await expect(edit).toBeVisible();
  await page.reload();
  await expect(edit).toBeVisible();
  await edit.click();
  const editor = page.getByRole("dialog", { name: "Edit post" });
  await editor.getByLabel("Title").fill("Founder launch lesson, revised");
  await editor.getByText("Ready for review", { exact: true }).click();
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("button", { name: "Edit Founder launch lesson, revised on Instagram" }),
  ).toBeVisible();
  expect(contentVersion).toBe(2);
});

test("organic calendar is route-restored, mobile-safe, and hands AI work to chat", async ({
  page,
}) => {
  await mockWorkspace(page);
  const scheduledAt = `${madridDateKey()}T10:00:00Z`;
  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        calendar: {
          timezone: "Europe/Madrid",
          plans: [],
          contentItems: [
            {
              id: "item_mobile",
              title: "Build in public",
              coreCopy: "A useful shipping note.",
              status: "draft",
              version: 3,
            },
          ],
          publications: [
            {
              id: "pub_mobile",
              contentItemId: "item_mobile",
              platform: "youtube",
              format: "short",
              status: "draft",
              title: "Build in public",
              body: "A useful shipping note.",
              scheduledAt,
            },
          ],
        },
      }),
    }),
  );
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        'data: {"type":"start","question":"plan"}\n\n' +
        'data: {"type":"text-delta","text":"Here is the plan."}\n\n' +
        'data: {"type":"done"}\n\n',
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app?mode=organic&view=calendar");
  await expect(page.getByRole("heading", { name: "Content planner" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Content planner" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);

  await page.getByRole("button", { name: "Ask assistant" }).click();
  await expect(page).toHaveURL(/mode=organic&view=assistant/);
  await expect(page.getByTestId("assistant-response")).toContainText("Here is the plan.");
  await page.goBack();
  await expect(page).toHaveURL(/mode=organic&view=calendar/);
  await expect(page.getByRole("heading", { name: "Content planner" })).toBeVisible();
});
