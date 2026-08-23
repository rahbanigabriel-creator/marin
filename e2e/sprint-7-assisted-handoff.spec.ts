import { expect, test, type Page, type Route } from "@playwright/test";

test.setTimeout(120_000);

const TIMEZONE = "Europe/Madrid";
const NOW = "2026-07-20T08:00:00.000Z";
const BRAND = {
  id: "brand_handoff",
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
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockShell(page: Page, canManage = true): Promise<void> {
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
}

function contentItem(version = 4) {
  return {
    id: "item_handoff",
    brandId: BRAND.id,
    planId: null,
    status: "approved",
    source: "manual",
    title: "The founder distribution loop",
    brief: "Show one useful workflow.",
    coreCopy: "Build distribution while you build the product.",
    objective: "Teach solo founders",
    metadata: null,
    version,
    approvedBy: "owner_1",
    approvedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

test("an owner completes an honest assisted handoff after a recorded failure", async ({ page }) => {
  await mockShell(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  let status = "ready";
  let publishedAt: string | null = null;
  let permalink: string | null = null;
  let lastError: string | null = null;
  let attempts: Array<Record<string, unknown>> = [];
  let postCalls = 0;
  const scheduledAt = `${madridDateKey()}T10:00:00+02:00`;

  await page.addInitScript(() => {
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      if (this.href.includes("/api/assets/") && this.href.includes("disposition=attachment")) {
        const current = Number(sessionStorage.getItem("marpin-download-clicks") ?? "0");
        sessionStorage.setItem("marpin-download-clicks", String(current + 1));
      }
      return originalClick.call(this);
    };
  });

  const publication = () => ({
    id: "pub_handoff",
    contentItemId: "item_handoff",
    channelAccountId: null,
    platform: "tiktok",
    format: "video",
    status,
    title: "Stop treating distribution as launch day",
    body: "Ship one useful product lesson every day and let demand compound.",
    firstComment: "What did you learn while building today?",
    linkUrl: "https://www.marpin.ai",
    scheduledAt,
    publishedAt,
    permalink,
    publishAttempts: attempts.length,
    lastError,
    createdAt: NOW,
    updatedAt: NOW,
  });
  const handoff = () => ({
    publication: {
      id: "pub_handoff",
      contentItemId: "item_handoff",
      platform: "tiktok",
      format: "video",
      status,
      contentVersion: 4,
      publishedAt,
      permalink,
      externalCompletionEvidence: status === "published" ? "user_confirmed_external_handoff" : "not_recorded",
      publishAttempts: attempts.length,
      lastError,
    },
    copy: {
      title: "Stop treating distribution as launch day",
      body: "Ship one useful product lesson every day and let demand compound.",
      firstComment: "What did you learn while building today?",
      linkUrl: "https://www.marpin.ai",
    },
    assets: [
      { id: "asset_one", position: 0, role: "cover", altText: "Calendar", filename: "calendar.png", mimeType: "image/png", bytes: 100, downloadUrl: "/api/assets/asset_one/content?disposition=attachment" },
      { id: "asset_two", position: 1, role: "media", altText: "Workflow", filename: "workflow.png", mimeType: "image/png", bytes: 120, downloadUrl: "/api/assets/asset_two/content?disposition=attachment" },
    ],
    capability: {
      level: "assisted",
      openPlatformUrl: "https://www.tiktok.com/tiktokstudio/upload",
      canPrepare: true,
      canRecord: status === "ready" || status === "failed",
      reasonCode: null,
      reason: null,
    },
    attempts,
  });

  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    json(route, {
      calendar: {
        timezone: TIMEZONE,
        plans: [],
        contentItems: [contentItem()],
        publications: [publication()],
      },
    }),
  );
  await page.route(/\/api\/publications\/pub_handoff\/assisted-handoff$/, async (route) => {
    if (route.request().method() === "GET") {
      await json(route, handoff());
      return;
    }
    postCalls += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.expectedContentVersion).toBe(4);
    expect(typeof body.requestId).toBe("string");
    if (body.outcome === "failed") {
      expect(body.failureReason).toBe("TikTok rejected the file during upload.");
      status = "failed";
      lastError = String(body.failureReason);
      attempts = [{ id: "attempt_failed", outcome: "failed", contentVersion: 4, permalink: null, error: lastError, attemptedAt: "2026-07-20T09:00:00.000Z" }];
    } else {
      expect(body.outcome).toBe("completed");
      expect(body.permalink).toBe("https://www.tiktok.com/@marpin/video/7523456789012345678");
      status = "published";
      permalink = String(body.permalink);
      publishedAt = "2026-07-20T09:10:00.000Z";
      lastError = null;
      attempts = [
        { id: "attempt_complete", outcome: "completed", contentVersion: 4, permalink, error: null, attemptedAt: publishedAt },
        ...attempts,
      ];
    }
    await json(route, { handoff: handoff(), reused: false }, 201);
  });
  await page.route(/\/api\/assets\/asset_(?:one|two)\/content(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "Content-Disposition": "attachment; filename=\"proof.png\"" },
      body: Buffer.from("proof"),
    });
  });

  await page.goto("/app?mode=organic&view=calendar&calendarView=week");
  await page.getByRole("button", { name: "Edit Stop treating distribution as launch day on TikTok" }).click();
  await page.getByRole("button", { name: "Finish externally" }).click();
  const dialog = page.getByRole("dialog", { name: "Assisted handoff" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close assisted handoff" })).toBeFocused();
  await dialog.getByRole("button", { name: "Copy body" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    "Ship one useful product lesson every day and let demand compound.",
  );
  const platformLink = dialog.getByRole("link", { name: "Open TikTok" });
  await expect(platformLink).toHaveAttribute("href", "https://www.tiktok.com/tiktokstudio/upload");
  await expect(platformLink).toHaveAttribute("rel", /noopener/);
  await dialog.getByRole("button", { name: "Download all media" }).click();
  await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem("marpin-download-clicks") ?? "0"))).toBe(2);

  await dialog.getByRole("button", { name: "Record failure" }).click();
  await dialog.getByLabel("What stopped you?").fill("TikTok rejected the file during upload.");
  await dialog.getByRole("button", { name: "Confirm failure" }).click();
  await expect(dialog.getByText("Needs another try", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText("Could not complete", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Try again" }).click();
  await dialog.getByLabel("Public post URL").fill(
    "https://www.tiktok.com/@marpin/video/7523456789012345678",
  );
  await dialog.getByRole("button", { name: "Confirm complete" }).click();
  await expect(dialog.getByText("User-confirmed external handoff", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByRole("link", { name: "View external post" })).toHaveAttribute(
    "href",
    "https://www.tiktok.com/@marpin/video/7523456789012345678",
  );
  expect(postCalls).toBe(2);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "View Stop treating distribution as launch day on TikTok" })).toBeVisible();
  await expect(page.getByText("External completion recorded", { exact: true }).first()).toBeVisible();
});

test("a stale handoff reloads the approved snapshot before recording completion", async ({ page }) => {
  await mockShell(page);
  let serverVersion = 4;
  let postCalls = 0;
  let firstRequestId = "";
  const scheduledAt = `${madridDateKey()}T10:00:00+02:00`;
  const publication = {
    id: "pub_stale_handoff",
    contentItemId: "item_handoff",
    channelAccountId: null,
    platform: "youtube",
    format: "video",
    status: "ready",
    title: "Distribution is a weekly product habit",
    body: "Show the work every week.",
    firstComment: null,
    linkUrl: null,
    scheduledAt,
    publishedAt: null,
    permalink: null,
    publishAttempts: 0,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const handoff = (status = "ready") => ({
    publication: { id: publication.id, contentItemId: "item_handoff", platform: "youtube", format: "video", status, contentVersion: serverVersion, publishedAt: status === "published" ? NOW : null, permalink: status === "published" ? "https://www.youtube.com/watch?v=AbCdEf12_-3" : null, externalCompletionEvidence: status === "published" ? "user_confirmed_external_handoff" : "not_recorded", publishAttempts: status === "published" ? 1 : 0, lastError: null },
    copy: { title: publication.title, body: publication.body, firstComment: null, linkUrl: null },
    assets: [],
    capability: { level: "assisted", openPlatformUrl: "https://studio.youtube.com/", canPrepare: true, canRecord: status === "ready", reasonCode: status === "ready" ? null : "publication_history_only", reason: status === "ready" ? null : "This publication is history-only" },
    attempts: status === "published" ? [{ id: "attempt_stale_complete", outcome: "completed", contentVersion: serverVersion, permalink: "https://www.youtube.com/watch?v=AbCdEf12_-3", error: null, attemptedAt: NOW }] : [],
  });

  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    json(route, { calendar: { timezone: TIMEZONE, plans: [], contentItems: [contentItem()], publications: [publication] } }),
  );
  await page.route(/\/api\/publications\/pub_stale_handoff\/assisted-handoff$/, async (route) => {
    if (route.request().method() === "GET") {
      await json(route, handoff());
      return;
    }
    postCalls += 1;
    const body = route.request().postDataJSON() as { requestId: string; expectedContentVersion: number };
    if (postCalls === 1) {
      firstRequestId = body.requestId;
      expect(body.expectedContentVersion).toBe(4);
      serverVersion = 5;
      await json(route, { error: "version_conflict", code: "version_conflict", message: "The approved content changed elsewhere.", currentVersion: 5 }, 409);
      return;
    }
    expect(body.expectedContentVersion).toBe(5);
    expect(body.requestId).toBe(firstRequestId);
    await json(route, { ...handoff("published"), reused: false }, 201);
  });

  await page.goto("/app?mode=organic&view=calendar&calendarView=week");
  await page.getByRole("button", { name: "Edit Distribution is a weekly product habit on YouTube" }).click();
  await page.getByRole("button", { name: "Finish externally" }).click();
  const dialog = page.getByRole("dialog", { name: "Assisted handoff" });
  await dialog.getByRole("button", { name: "Mark complete" }).click();
  await dialog.getByLabel("Public post URL").fill("https://www.youtube.com/watch?v=AbCdEf12_-3");
  await dialog.getByRole("button", { name: "Confirm complete" }).click();
  await expect(dialog.getByRole("alert")).toContainText("changed elsewhere");
  await dialog.getByRole("button", { name: "Reload latest" }).click();
  await expect(dialog.getByLabel("Public post URL")).toBeVisible();
  await dialog.getByLabel("Public post URL").fill("https://www.youtube.com/watch?v=AbCdEf12_-3");
  await dialog.getByRole("button", { name: "Confirm complete" }).click();
  await expect(dialog.getByText("User-confirmed external handoff", { exact: true }).first()).toBeVisible();
  expect(postCalls).toBe(2);
});

test("a member can inspect persisted handoff history on a mobile Studio without action controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShell(page, false);
  const published = {
    ...contentItem(),
    publications: undefined,
  };
  const publication = {
    id: "pub_member_handoff",
    contentItemId: "item_handoff",
    channelAccountId: null,
    platform: "pinterest",
    format: "pin",
    status: "published",
    title: "A founder distribution checklist",
    body: "Save this checklist before your next launch.",
    firstComment: null,
    linkUrl: null,
    scheduledAt: `${madridDateKey()}T11:00:00+02:00`,
    publishedAt: "2026-07-20T10:00:00.000Z",
    permalink: "https://www.pinterest.com/pin/123456789012345678/",
    publishAttempts: 1,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    json(route, { calendar: { timezone: TIMEZONE, plans: [], contentItems: [], publications: [] } }),
  );
  await page.route(/\/api\/content\/items\?brandId=.*/, (route) =>
    json(route, { items: [{ contentItem: published, publications: [publication], assets: [] }] }),
  );
  await page.route(/\/api\/assets(?:\?.*)?$/, (route) =>
    json(route, { assets: [], capabilities: { imageGeneration: false }, nextCursor: null }),
  );
  await page.route(/\/api\/publications\/pub_member_handoff\/assisted-handoff$/, (route) =>
    json(route, {
      publication: { id: publication.id, contentItemId: "item_handoff", platform: "pinterest", format: "pin", status: "published", contentVersion: 4, publishedAt: publication.publishedAt, permalink: publication.permalink, externalCompletionEvidence: "user_confirmed_external_handoff", publishAttempts: 1, lastError: null },
      copy: { title: publication.title, body: publication.body, firstComment: "", linkUrl: "" },
      assets: [{ id: "member_asset", position: 0, role: "media", altText: null, filename: "private.png", mimeType: "image/png", bytes: 100, downloadUrl: "/api/assets/member_asset/content?disposition=attachment" }],
      capability: { level: "assisted", openPlatformUrl: "https://www.pinterest.com/pin-creation-tool/", canPrepare: false, canRecord: false, reasonCode: "role_required", reason: "Only workspace owners and admins can prepare or record a handoff." },
      attempts: [{ id: "attempt_member", outcome: "completed", contentVersion: 4, permalink: publication.permalink, error: null, attemptedAt: publication.publishedAt }],
    }),
  );

  await page.goto("/app?mode=organic&view=studio");
  const trigger = page.getByRole("button", { name: "View handoff" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Assisted handoff" });
  await expect(dialog.getByText("User-confirmed external handoff", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText("Only workspace owners and admins can prepare or record a handoff.")).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Post copy" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Open Pinterest" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Download" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Mark complete" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Record failure" })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("an owner cannot prepare copy or media until the current content version is approved", async ({ page }) => {
  await mockShell(page, true);
  const reviewItem = {
    ...contentItem(),
    status: "review",
    approvedBy: null,
    approvedAt: null,
  };
  const publication = {
    id: "pub_unapproved_handoff",
    contentItemId: reviewItem.id,
    channelAccountId: null,
    platform: "reddit",
    format: "post",
    status: "ready",
    title: "Review this founder lesson",
    body: "This revision still needs approval.",
    firstComment: null,
    linkUrl: null,
    scheduledAt: `${madridDateKey()}T12:00:00+02:00`,
    publishedAt: null,
    permalink: null,
    publishAttempts: 0,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    json(route, { calendar: { timezone: TIMEZONE, plans: [], contentItems: [], publications: [] } }),
  );
  await page.route(/\/api\/content\/items\?brandId=.*/, (route) =>
    json(route, { items: [{ contentItem: reviewItem, publications: [publication], assets: [] }] }),
  );
  await page.route(/\/api\/assets(?:\?.*)?$/, (route) =>
    json(route, { assets: [], capabilities: { imageGeneration: false }, nextCursor: null }),
  );
  await page.route(/\/api\/publications\/pub_unapproved_handoff\/assisted-handoff$/, (route) =>
    json(route, {
      publication: { id: publication.id, contentItemId: reviewItem.id, platform: "reddit", format: "post", status: "ready", contentVersion: 4, publishedAt: null, permalink: null, publishAttempts: 0, lastError: null },
      copy: { title: null, body: "", firstComment: null, linkUrl: null },
      assets: [],
      capability: { level: "assisted", openPlatformUrl: null, canPrepare: false, canRecord: false, reasonCode: "content_version_not_approved", reason: "Approve this content version before handing it off" },
      attempts: [],
    }),
  );

  await page.goto("/app?mode=organic&view=studio");
  const trigger = page.getByRole("button", { name: "Finish externally" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Assisted handoff" });
  await expect(dialog.getByText("Approve this content version before handing it off")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Review and approve in Studio" })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "Post copy" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Open Reddit" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Download" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Mark complete" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Record failure" })).toHaveCount(0);
});

test("the calendar handoff opens the exact unapproved item in Content Studio", async ({ page }) => {
  await mockShell(page, true);
  const reviewItem = {
    ...contentItem(),
    status: "review",
    approvedBy: null,
    approvedAt: null,
  };
  const publication = {
    id: "pub_calendar_review",
    contentItemId: reviewItem.id,
    channelAccountId: null,
    platform: "reddit",
    format: "post",
    status: "ready",
    title: "Review this founder lesson",
    body: "This revision still needs approval.",
    firstComment: null,
    linkUrl: null,
    scheduledAt: `${madridDateKey()}T12:00:00+02:00`,
    publishedAt: null,
    permalink: null,
    publishAttempts: 0,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) =>
    json(route, {
      calendar: {
        timezone: TIMEZONE,
        plans: [],
        contentItems: [reviewItem],
        publications: [publication],
      },
    }),
  );
  await page.route(/\/api\/content\/items\?brandId=.*/, (route) =>
    json(route, { items: [{ contentItem: reviewItem, publications: [publication], assets: [] }], nextCursor: null }),
  );
  await page.route(/\/api\/assets(?:\?.*)?$/, (route) =>
    json(route, { assets: [], capabilities: { imageGeneration: false }, nextCursor: null }),
  );
  await page.route(/\/api\/publications\/pub_calendar_review\/assisted-handoff$/, (route) =>
    json(route, {
      publication: { id: publication.id, contentItemId: reviewItem.id, platform: "reddit", format: "post", status: "ready", contentVersion: 4, publishedAt: null, permalink: null, publishAttempts: 0, lastError: null },
      copy: { title: null, body: "", firstComment: null, linkUrl: null },
      assets: [],
      capability: { level: "assisted", openPlatformUrl: null, canPrepare: false, canRecord: false, reasonCode: "content_version_not_approved", reason: "Approve this content version before handing it off" },
      attempts: [],
    }),
  );

  await page.goto("/app?mode=organic&view=calendar&calendarView=week");
  await page.getByRole("button", { name: "Edit Review this founder lesson on Reddit" }).click();
  await page.getByRole("dialog", { name: "Edit post" }).getByRole("button", { name: "Finish externally" }).click();
  const dialog = page.getByRole("dialog", { name: "Assisted handoff" });
  const review = dialog.getByRole("button", { name: "Review and approve in Studio" });
  await expect(review).toBeVisible();
  await review.click();

  await expect(page).toHaveURL(/view=studio/);
  await expect(page.getByRole("heading", { name: "Content Studio" })).toBeVisible();
  await expect(page.getByRole("heading", { name: reviewItem.title })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
});
