import { expect, test, type Page, type Route } from "@playwright/test";

import type {
  CalendarPublicationDto,
  ContentItemDto,
  ContentPlanDto,
} from "../src/components/organic/types";

test.setTimeout(120_000);

const TIMEZONE = "Europe/Madrid";
const BRAND = {
  id: "brand_sprint5",
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
  timezone: TIMEZONE,
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
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDateKey(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextMondayKey(): string {
  const today = madridDateKey();
  const weekday = new Date(`${today}T12:00:00.000Z`).getUTCDay();
  return addDateKey(today, ((8 - weekday) % 7) || 7);
}

function nextMonthBounds(): { start: string; end: string; days: number } {
  const today = madridDateKey();
  const [year, month] = today.split("-").map(Number);
  const start = new Date(Date.UTC(year, month, 1, 12));
  const end = new Date(Date.UTC(year, month + 1, 1, 12));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    days: Math.round((end.getTime() - start.getTime()) / 86_400_000),
  };
}

function currentMonthGrid(): {
  start: string;
  end: string;
  currentLabel: string;
  nextLabel: string;
} {
  const today = madridDateKey();
  const first = `${today.slice(0, 7)}-01`;
  const firstDate = new Date(`${first}T12:00:00.000Z`);
  const mondayOffset = (firstDate.getUTCDay() + 6) % 7;
  const nextMonth = new Date(Date.UTC(
    firstDate.getUTCFullYear(),
    firstDate.getUTCMonth() + 1,
    1,
    12,
  ));
  const monthLabel = (value: Date) => new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
  const start = addDateKey(first, -mondayOffset);
  return {
    start,
    end: addDateKey(start, 41),
    currentLabel: monthLabel(firstDate),
    nextLabel: monthLabel(nextMonth),
  };
}

function plan(id = "plan_ops"): ContentPlanDto {
  return {
    id,
    version: 1,
    name: "Founder distribution week",
    objective: "Ship a useful idea every day",
    status: "draft",
    period: "week",
    startDate: `${madridDateKey()}T00:00:00+02:00`,
    endDate: `${madridDateKey(7)}T00:00:00+02:00`,
    timezone: TIMEZONE,
  };
}

function item(
  id = "item_ops",
  planId: string | null = "plan_ops",
  version = 1,
  title = "Founder distribution lesson",
): ContentItemDto {
  return {
    id,
    planId,
    title,
    coreCopy: "A practical note about building distribution before launch day.",
    status: "draft",
    version,
  };
}

function publication(
  id = "pub_ops",
  contentItemId = "item_ops",
  scheduledAt = `${madridDateKey()}T10:00:00+02:00`,
  title = "Founder distribution lesson",
): CalendarPublicationDto {
  return {
    id,
    contentItemId,
    platform: "instagram",
    format: "post",
    status: "draft",
    title,
    body: "A practical note about building distribution before launch day.",
    scheduledAt,
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockWorkspace(
  page: Page,
  options: {
    canManage?: boolean;
    billingDelayMs?: number;
    billingStatus?: number;
  } = {},
): Promise<void> {
  await page.route(/\/api\/connections(?:\?.*)?$/, (route) =>
    fulfillJson(route, { workspace: { name: "Solo Founder" }, connections: [] }),
  );
  await page.route(/\/api\/brands(?:\?.*)?$/, (route) =>
    fulfillJson(route, { brands: [BRAND] }),
  );
  await page.route(/\/api\/conversations(?:\?.*)?$/, (route) =>
    fulfillJson(route, { conversations: [] }),
  );
  await page.route(/\/api\/billing(?:\?.*)?$/, async (route) => {
    if (options.billingDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.billingDelayMs));
    }
    await fulfillJson(route, {
      billing: {
        canManage: options.canManage ?? true,
        entitlements: { canUseOpus: false },
        resources: { connections: 0 },
      },
    }, options.billingStatus ?? 200);
  });
}

test("plan lifecycle, filters, URL state, and confirmed deletes stay coherent", async ({ page }) => {
  await mockWorkspace(page);
  let savedPlan: ContentPlanDto | null = plan();
  let savedItem: ContentItemDto | null = item();
  let savedPublication: CalendarPublicationDto | null = publication();

  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    fulfillJson(route, {
      calendar: {
        timezone: TIMEZONE,
        plans: savedPlan ? [savedPlan] : [],
        contentItems: savedItem ? [savedItem] : [],
        publications: savedPublication ? [savedPublication] : [],
      },
    }),
  );
  await page.route(/\/api\/content\/plans\/plan_ops$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, string | number>;
    expect(body.expectedVersion).toBe(savedPlan?.version);
    if (route.request().method() === "DELETE") {
      savedPlan = null;
      if (savedItem) {
        savedItem = { ...savedItem, planId: null, version: savedItem.version + 1 };
      }
      await fulfillJson(route, {
        planId: "plan_ops",
        deleted: true,
        contentItems: savedItem ? [savedItem] : [],
      });
      return;
    }
    if (!savedPlan) throw new Error("Expected the plan to exist");
    savedPlan = {
      ...savedPlan,
      name: String(body.name),
      objective: String(body.objective),
      status: body.status as ContentPlanDto["status"],
      version: savedPlan.version + 1,
    };
    await fulfillJson(route, { plan: savedPlan });
  });
  await page.route(/\/api\/content\/variants\/pub_ops$/, async (route) => {
    expect(route.request().method()).toBe("DELETE");
    const body = route.request().postDataJSON() as { expectedVersion: number };
    expect(body.expectedVersion).toBe(savedItem?.version);
    const nextVersion = (savedItem?.version ?? 0) + 1;
    savedPublication = null;
    await fulfillJson(route, {
      publicationId: "pub_ops",
      contentItemId: "item_ops",
      contentItemVersion: nextVersion,
    });
  });

  await page.goto("/app?mode=organic&view=calendar&calendarView=month&plan=plan_ops");
  await expect(page.getByRole("heading", { name: "Content planner" })).toBeVisible();
  await expect(page.getByRole("button", { name: "month", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Content plan", { exact: true })).toHaveValue("plan_ops");
  await expect(page).toHaveURL(/calendarView=month/);
  await expect(page).toHaveURL(/plan=plan_ops/);
  const compactCard = page.locator("[data-calendar-day] article").filter({
    hasText: "Founder distribution lesson",
  });
  await expect(compactCard.getByRole("button", { name: /Move Founder distribution lesson/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Instagram", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No posts match these filters" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("button", { name: "Edit Founder distribution lesson on Instagram" })).toBeVisible();
  await page.getByLabel("Content plan", { exact: true }).selectOption("plan_ops");

  await page.getByRole("button", { name: "Manage Founder distribution week" }).click();
  const planDialog = page.getByRole("dialog", { name: "Manage content plan" });
  await planDialog.getByLabel("Plan name").fill("Founder distribution system");
  await planDialog.getByText("active", { exact: true }).click();
  await planDialog.getByRole("button", { name: "Save plan" }).click();
  await expect(page.getByLabel("Content plan", { exact: true })).toContainText("Founder distribution system");

  await page.getByRole("button", { name: "Manage Founder distribution system" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Manage content plan" });
  await deleteDialog.getByRole("button", { name: "Delete plan" }).click();
  await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByLabel("Content plan", { exact: true })).toHaveValue("");
  await expect(page).not.toHaveURL(/plan=plan_ops/);

  await page.getByRole("button", { name: "Edit Founder distribution lesson on Instagram" }).click();
  const postDialog = page.getByRole("dialog", { name: "Edit post" });
  await postDialog.getByRole("button", { name: "Remove post" }).click();
  await postDialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No posts planned yet" })).toBeVisible();
});

test("period navigation shows loading until the next calendar range is ready", async ({ page }) => {
  await mockWorkspace(page);
  let initialRangeStart = "";

  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, async (route) => {
    const start = new URL(route.request().url()).searchParams.get("start") ?? "";
    if (!initialRangeStart) initialRangeStart = start;
    if (start === initialRangeStart) {
      await fulfillJson(route, {
        calendar: { timezone: TIMEZONE, plans: [], contentItems: [], publications: [] },
      });
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 700));
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(start));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((entry) => entry.type === type)?.value ?? "";
    const rangeStart = `${part("year")}-${part("month")}-${part("day")}`;
    const nextPlan = {
      ...plan("plan_next_range"),
      startDate: `${rangeStart}T00:00:00+02:00`,
      endDate: `${addDateKey(rangeStart, 7)}T00:00:00+02:00`,
    };
    const nextItem = item("item_next_range", nextPlan.id, 1, "Next week launch lesson");
    const nextPublication = publication(
      "pub_next_range",
      nextItem.id,
      `${addDateKey(rangeStart, 1)}T10:00:00+02:00`,
      nextItem.title,
    );
    await fulfillJson(route, {
      calendar: {
        timezone: TIMEZONE,
        plans: [nextPlan],
        contentItems: [nextItem],
        publications: [nextPublication],
      },
    });
  });

  await page.goto("/app?mode=organic&view=calendar&calendarView=week");
  await expect(page.getByRole("heading", { name: "No posts planned yet" })).toBeVisible();
  await page.getByRole("button", { name: "Next week", exact: true }).click();
  await expect(page.getByText("Loading your organic plan")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No posts planned yet" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Next week launch lesson on Instagram" })).toBeVisible();
});

test("desktop drag/drop is optimistic and a stale edit recovers without losing the calendar", async ({ page }) => {
  await mockWorkspace(page);
  let version = 1;
  let scheduledAt = `${madridDateKey()}T10:00:00+02:00`;
  let patchCount = 0;
  const siblingPublication = {
    ...publication(
      "pub_sibling",
      "item_ops",
      `${madridDateKey(1)}T11:00:00+02:00`,
      "Founder sibling lesson",
    ),
    platform: "facebook" as const,
  };

  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    fulfillJson(route, {
      calendar: {
        timezone: TIMEZONE,
        plans: [plan()],
        contentItems: [item("item_ops", "plan_ops", version)],
        publications: [publication("pub_ops", "item_ops", scheduledAt), siblingPublication],
      },
    }),
  );
  await page.route(/\/api\/content\/variants\/pub_ops$/, async (route) => {
    expect(route.request().method()).toBe("PATCH");
    patchCount += 1;
    const body = route.request().postDataJSON() as Record<string, string | number>;
    expect(body.expectedVersion).toBe(version);
    if (patchCount === 2) {
      await fulfillJson(route, {
        error: "version_conflict",
        code: "version_conflict",
        message: "This post changed elsewhere. Reload the latest version.",
        currentVersion: version + 1,
      }, 409);
      return;
    }
    scheduledAt = String(body.scheduledAt);
    version += 1;
    await fulfillJson(route, {
      post: {
        contentItem: item("item_ops", "plan_ops", version),
        publication: publication("pub_ops", "item_ops", scheduledAt),
      },
    });
  });
  await page.route(/\/api\/content\/variants\/pub_sibling$/, async (route) => {
    expect(route.request().method()).toBe("PATCH");
    const body = route.request().postDataJSON() as { expectedVersion: number };
    expect(body.expectedVersion).toBe(2);
    await fulfillJson(route, {
      error: "version_conflict",
      code: "version_conflict",
      message: "This post changed elsewhere. Reload the latest version.",
      currentVersion: 3,
    }, 409);
  });

  await page.goto("/app?mode=organic&view=calendar&calendarView=week");
  const editButton = page.getByRole("button", { name: "Edit Founder distribution lesson on Instagram" });
  await expect(editButton).toBeVisible();
  const sourceDate = scheduledAt.slice(0, 10);
  const dayKeys = await page.locator("[data-calendar-day]").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-calendar-day")).filter(Boolean),
  );
  const targetDate = dayKeys.find((date) => date !== sourceDate);
  if (!targetDate) throw new Error("Expected another visible calendar day");
  const targetDay = page.locator(`[data-calendar-day="${targetDate}"]`);
  await editButton.locator("xpath=ancestor::article").dragTo(targetDay, {
    targetPosition: { x: 20, y: 80 },
  });
  await expect.poll(() => patchCount).toBe(1);
  expect(scheduledAt.slice(0, 10)).toBe(targetDate);
  await expect(page.getByText("Calendar unavailable")).toHaveCount(0);

  await page.getByRole("button", { name: "Edit Founder sibling lesson on Facebook" }).click();
  const siblingEditor = page.getByRole("dialog", { name: "Edit post" });
  await siblingEditor.getByRole("button", { name: "Save changes" }).click();
  await expect(siblingEditor.getByRole("alert")).toContainText("changed elsewhere");
  await siblingEditor.getByRole("button", { name: "Reload latest" }).click();
  await expect(siblingEditor).toBeHidden();

  await editButton.click();
  const editor = page.getByRole("dialog", { name: "Edit post" });
  await editor.getByLabel("Title").fill("A stale founder lesson");
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(editor.getByRole("alert")).toContainText("changed elsewhere");
  await editor.getByRole("button", { name: "Reload latest" }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit Founder distribution lesson on Instagram" })).toBeVisible();
  await expect(page.getByText("Calendar unavailable")).toHaveCount(0);
});

test("a failed optimistic drag restores the original calendar day", async ({ page }) => {
  await mockWorkspace(page);
  const sourceDate = madridDateKey();
  let patchCount = 0;

  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    fulfillJson(route, {
      calendar: {
        timezone: TIMEZONE,
        plans: [plan()],
        contentItems: [item()],
        publications: [publication("pub_ops", "item_ops", `${sourceDate}T10:00:00+02:00`)],
      },
    }),
  );
  await page.route(/\/api\/content\/variants\/pub_ops$/, async (route) => {
    patchCount += 1;
    await fulfillJson(route, { message: "The post could not be moved." }, 500);
  });

  await page.goto("/app?mode=organic&view=calendar&calendarView=week");
  const editButton = page.getByRole("button", { name: "Edit Founder distribution lesson on Instagram" });
  const sourceDay = page.locator(`[data-calendar-day="${sourceDate}"]`);
  await expect(sourceDay.getByRole("button", { name: "Edit Founder distribution lesson on Instagram" })).toBeVisible();
  const dayKeys = await page.locator("[data-calendar-day]").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-calendar-day")).filter(Boolean),
  );
  const targetDate = dayKeys.find((date) => date !== sourceDate);
  if (!targetDate) throw new Error("Expected another visible calendar day");
  const targetDay = page.locator(`[data-calendar-day="${targetDate}"]`);

  await editButton.locator("xpath=ancestor::article").dragTo(targetDay, {
    targetPosition: { x: 20, y: 80 },
  });
  await expect.poll(() => patchCount).toBe(1);
  await expect(
    page.getByRole("alert").filter({ hasText: "The post could not be moved." }),
  ).toContainText("The post could not be moved.");
  await expect(sourceDay.getByRole("button", { name: "Edit Founder distribution lesson on Instagram" })).toBeVisible();
  await expect(targetDay.getByRole("button", { name: "Edit Founder distribution lesson on Instagram" })).toHaveCount(0);
});

test("members see locked ready-post movement and focus remains inside read-only dialogs", async ({ page }) => {
  await mockWorkspace(page, { canManage: false });
  const activePlan = { ...plan(), status: "active" as const };
  const reviewItem = { ...item(), status: "review" };
  const readyPublication = { ...publication(), status: "ready" as const };

  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    fulfillJson(route, {
      calendar: {
        timezone: TIMEZONE,
        plans: [activePlan],
        contentItems: [reviewItem],
        publications: [readyPublication],
      },
    }),
  );

  await page.goto("/app?mode=organic&view=calendar&calendarView=week&plan=plan_ops");
  const editButton = page.getByRole("button", { name: "Edit Founder distribution lesson on Instagram" });
  const card = editButton.locator("xpath=ancestor::article");
  await expect(card).toHaveAttribute("draggable", "false");
  await expect(card.getByRole("button", { name: /one day earlier/ })).toBeDisabled();
  await expect(card.getByRole("button", { name: /one day later/ })).toBeDisabled();

  await editButton.click();
  const postDialog = page.getByRole("dialog", { name: "Edit post" });
  await expect(postDialog.getByRole("button", { name: "Close post editor" })).toBeFocused();
  await expect(postDialog.getByLabel("Title")).toBeDisabled();
  await postDialog.getByRole("button", { name: "Close post editor" }).click();

  await page.getByRole("button", { name: "Manage Founder distribution week" }).click();
  const planDialog = page.getByRole("dialog", { name: "Manage content plan" });
  await expect(planDialog.getByRole("button", { name: "Close plan editor" })).toBeFocused();
  await expect(planDialog.getByLabel("Plan name")).toBeDisabled();
});

test("calendar permissions fail closed while billing is pending and after it fails", async ({ page }) => {
  await mockWorkspace(page, { canManage: true, billingDelayMs: 2_000, billingStatus: 503 });
  const activePlan = { ...plan(), status: "active" as const };
  const reviewItem = { ...item(), status: "review" };
  const readyPublication = { ...publication(), status: "ready" as const };
  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    fulfillJson(route, {
      calendar: {
        timezone: TIMEZONE,
        plans: [activePlan],
        contentItems: [reviewItem],
        publications: [readyPublication],
      },
    }),
  );

  const billingResponse = page.waitForResponse(/\/api\/billing(?:\?.*)?$/);
  await page.goto("/app?mode=organic&view=calendar&calendarView=week&plan=plan_ops");
  const editButton = page.getByRole("button", { name: "Edit Founder distribution lesson on Instagram" });
  const card = editButton.locator("xpath=ancestor::article");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("draggable", "false");
  await expect(card.getByRole("button", { name: /one day later/ })).toBeDisabled();

  expect((await billingResponse).status()).toBe(503);
  await expect(card).toHaveAttribute("draggable", "false");
  await expect(card.getByRole("button", { name: /one day later/ })).toBeDisabled();
});

test("Plan next week persists and renders seven reviewable drafts", async ({ page }) => {
  await mockWorkspace(page);
  let generated: { plan: ContentPlanDto; items: ContentItemDto[]; publications: CalendarPublicationDto[] } | null = null;

  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    fulfillJson(route, {
      calendar: {
        timezone: TIMEZONE,
        plans: generated ? [generated.plan] : [],
        contentItems: generated?.items ?? [],
        publications: generated?.publications ?? [],
      },
    }),
  );
  await page.route(/\/api\/content\/plans\/generate$/, async (route) => {
    const body = route.request().postDataJSON() as {
      brandId: string;
      platforms: string[];
      requestId: string;
      period: string;
    };
    expect(body.brandId).toBe(BRAND.id);
    expect(body.platforms).toContain("instagram");
    expect(body.requestId.length).toBeGreaterThan(10);
    expect(body.period).toBe("week");
    const weekStart = nextMondayKey();
    const generatedPlan = {
      ...plan("plan_generated"),
      name: "Marpin next-week distribution",
      startDate: `${weekStart}T00:00:00+02:00`,
      endDate: `${addDateKey(weekStart, 7)}T00:00:00+02:00`,
    };
    const items = Array.from({ length: 7 }, (_, index) =>
      item(`item_generated_${index}`, generatedPlan.id, 1, `Founder idea ${index + 1}`),
    );
    const publications = items.map((contentItem, index) =>
      publication(
        `pub_generated_${index}`,
        contentItem.id,
        `${addDateKey(weekStart, index)}T09:00:00+02:00`,
        contentItem.title,
      ),
    );
    generated = { plan: generatedPlan, items, publications };
    await fulfillJson(route, {
      plan: generatedPlan,
      posts: items.map((contentItem, index) => ({
        contentItem,
        publication: publications[index],
      })),
      reused: false,
      fallback: false,
    }, 201);
  });

  await page.goto("/app?mode=organic&view=calendar");
  await expect(page.getByRole("heading", { name: "No posts planned yet" })).toBeVisible();
  await page.getByRole("button", { name: "Plan next week" }).first().click();
  await expect(page.getByLabel("Content plan", { exact: true })).toHaveValue("plan_generated");
  await expect(page.getByRole("button", { name: /Edit Founder idea/ })).toHaveCount(7);
  await expect(page).toHaveURL(/calendarView=week/);
  await expect(page).toHaveURL(/plan=plan_generated/);
});

test("Plan next month persists a complete daily plan in month view", async ({ page }) => {
  await mockWorkspace(page);
  const bounds = nextMonthBounds();
  let generated: {
    plan: ContentPlanDto;
    items: ContentItemDto[];
    publications: CalendarPublicationDto[];
  } | null = null;

  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    fulfillJson(route, {
      calendar: {
        timezone: TIMEZONE,
        plans: generated ? [generated.plan] : [],
        contentItems: generated?.items ?? [],
        publications: generated?.publications ?? [],
      },
    }),
  );
  await page.route(/\/api\/content\/plans\/generate$/, async (route) => {
    const body = route.request().postDataJSON() as {
      brandId: string;
      platforms: string[];
      requestId: string;
      period: string;
    };
    expect(body.period).toBe("month");
    const generatedPlan = {
      ...plan("plan_generated_month"),
      name: "Marpin next-month distribution",
      period: "month" as const,
      startDate: `${bounds.start}T00:00:00.000Z`,
      endDate: `${bounds.end}T00:00:00.000Z`,
    };
    const items = Array.from({ length: bounds.days }, (_, index) =>
      item(`item_month_${index}`, generatedPlan.id, 1, `Monthly idea ${index + 1}`),
    );
    const publications = items.map((contentItem, index) =>
      publication(
        `pub_month_${index}`,
        contentItem.id,
        `${addDateKey(bounds.start, index)}T09:00:00.000Z`,
        contentItem.title,
      ),
    );
    generated = { plan: generatedPlan, items, publications };
    await fulfillJson(route, {
      plan: generatedPlan,
      posts: items.map((contentItem, index) => ({
        contentItem,
        publication: publications[index],
      })),
      reused: false,
      fallback: false,
    }, 201);
  });

  await page.goto("/app?mode=organic&view=calendar&calendarView=month");
  await expect(page.getByRole("heading", { name: "No posts planned yet" })).toBeVisible();
  await page.getByRole("button", { name: "Plan next month" }).first().click();
  await expect(page.getByLabel("Content plan", { exact: true })).toHaveValue("plan_generated_month");
  await expect(page.getByRole("button", { name: /Edit Monthly idea/ })).toHaveCount(bounds.days);
  await expect(page).toHaveURL(/calendarView=month/);
  await expect(page).toHaveURL(/plan=plan_generated_month/);
});

test("mobile month paging reaches every loaded week while month navigation stays monthly", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkspace(page);
  const grid = currentMonthGrid();
  const firstItem = item("item_first_loaded_week", null, 1, "First loaded week");
  const lastItem = item("item_last_loaded_week", null, 1, "Last loaded week");
  const firstPublication = publication(
    "pub_first_loaded_week",
    firstItem.id,
    `${grid.start}T09:00:00+02:00`,
    firstItem.title,
  );
  const lastPublication = publication(
    "pub_last_loaded_week",
    lastItem.id,
    `${grid.end}T09:00:00+02:00`,
    lastItem.title,
  );

  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    fulfillJson(route, {
      calendar: {
        timezone: TIMEZONE,
        plans: [],
        contentItems: [firstItem, lastItem],
        publications: [firstPublication, lastPublication],
      },
    }),
  );

  await page.goto("/app?mode=organic&view=calendar&calendarView=month");
  const previousWeek = page.getByRole("button", { name: "Previous week in month" });
  const nextWeek = page.getByRole("button", { name: "Next week in month" });

  for (let index = 0; index < 6; index += 1) {
    if (await previousWeek.isEnabled()) await previousWeek.click();
  }
  await expect(previousWeek).toBeDisabled();
  await expect(page.getByText("Week 1 of 6", { exact: true })).toBeVisible();
  await page.locator(`[data-mobile-calendar-day="${grid.start}"]`).click();
  await expect(page.getByRole("button", { name: "Edit First loaded week on Instagram" })).toBeVisible();

  for (let index = 0; index < 5; index += 1) await nextWeek.click();
  await expect(nextWeek).toBeDisabled();
  await expect(page.getByText("Week 6 of 6", { exact: true })).toBeVisible();
  await page.locator(`[data-mobile-calendar-day="${grid.end}"]`).click();
  await expect(page.getByRole("button", { name: "Edit Last loaded week on Instagram" })).toBeVisible();
  await expect(page.getByRole("heading", { name: grid.currentLabel, exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(page.getByRole("heading", { name: grid.nextLabel, exact: true })).toBeVisible();
  await expect(page.getByText("Week 1 of 6", { exact: true })).toBeVisible();
});

test("monthly generation limit offers the API-provided billing upgrade action", async ({ page }) => {
  await mockWorkspace(page);
  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    fulfillJson(route, {
      calendar: { timezone: TIMEZONE, plans: [], contentItems: [], publications: [] },
    }),
  );
  await page.route(/\/api\/content\/plans\/generate$/, (route) =>
    fulfillJson(route, {
      error: "scheduled_post_limit",
      code: "scheduled_post_limit",
      message: "This workspace has reached its planned-post limit.",
      actionUrl: "/settings/billing",
    }, 402),
  );

  await page.goto("/app?mode=organic&view=calendar&calendarView=month");
  await page.getByRole("button", { name: "Plan next month" }).first().click();

  const notice = page.getByRole("alert").filter({ hasText: "planned-post limit" });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("link", { name: "Upgrade plan" })).toHaveAttribute(
    "href",
    "/settings/billing",
  );
  await expect(notice.getByRole("button", { name: "Reload latest" })).toHaveCount(0);
});

test("legacy Studio and SEO links override calendar and canonicalize the URL", async ({ page }) => {
  await mockWorkspace(page);
  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    fulfillJson(route, {
      calendar: { timezone: TIMEZONE, plans: [], contentItems: [], publications: [] },
    }),
  );
  await page.route(/\/api\/content\/items(?:\?.*)?$/, (route) =>
    fulfillJson(route, { items: [], nextCursor: null, hasMore: false }),
  );
  await page.route(/\/api\/assets(?:\?.*)?$/, (route) => fulfillJson(route, { assets: [] }));
  await page.route(/\/api\/seo\?brandId=.*/, (route) =>
    fulfillJson(route, { error: "seo_unavailable" }, 503),
  );

  await page.goto("/app?mode=organic&view=calendar&organicView=studio");
  await expect(page.getByRole("heading", { name: "Content Studio" })).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=studio(?:&|$)/);
  await expect(page).not.toHaveURL(/organicView=/);

  await page.goto("/app?mode=organic&view=calendar&organicView=seo");
  await expect(page.getByRole("heading", { name: "SEO workspace", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=seo(?:&|$)/);
  await expect(page).not.toHaveURL(/organicView=/);
});
