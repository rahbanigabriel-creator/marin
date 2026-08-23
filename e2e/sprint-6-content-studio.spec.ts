import { expect, test, type Page, type Route } from "@playwright/test";

import type {
  ContentAssetDto,
  ContentItemAssetDto,
  ContentItemDto,
  ContentPublicationDto,
  ContentStudioItemDto,
} from "../src/lib/content/types";

test.setTimeout(120_000);

const TIMEZONE = "Europe/Madrid";
const NOW = "2026-07-20T08:00:00.000Z";
const BRAND = {
  id: "brand_sprint6",
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

function contentItem(overrides: Partial<ContentItemDto> = {}): ContentItemDto {
  return {
    id: "item_studio",
    brandId: BRAND.id,
    planId: null,
    status: "draft",
    source: "manual",
    title: "Distribution before launch",
    brief: "Show the system, not a generic promise.",
    coreCopy: "Build distribution while you build the product.",
    objective: "Teach solo founders",
    metadata: null,
    version: 1,
    approvedBy: null,
    approvedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function asset(id = "asset_reference", filename = "reference.png"): ContentAssetDto {
  return {
    id,
    kind: "image",
    mimeType: "image/png",
    bytes: 68,
    filename,
    width: null,
    height: null,
    durationMs: null,
    source: "upload",
    contentUrl: `/api/assets/${id}/content`,
    createdAt: NOW,
  };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockShell(page: Page, canManage = true): Promise<void> {
  await page.clock.setFixedTime(new Date(NOW));
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
    json(route, { calendar: { timezone: TIMEZONE, plans: [], contentItems: [], publications: [] } }),
  );
}

test("an owner can edit master content, plan a channel variant, and reuse private media", async ({ page }) => {
  await mockShell(page);
  let studio: ContentStudioItemDto = {
    contentItem: contentItem(),
    publications: [],
    assets: [],
  };
  let calendarLoads = 0;
  let library = [asset()];
  const olderAsset = asset("asset_older", "older-proof.png");

  await page.route(/\/api\/content\/items\?brandId=.*/, (route) => json(route, { items: [studio] }));
  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, (route) => {
    calendarLoads += 1;
    return json(route, {
      calendar: {
        timezone: TIMEZONE,
        plans: [],
        contentItems: studio.publications.length ? [studio.contentItem] : [],
        publications: studio.publications,
      },
    });
  });
  await page.route(/\/api\/assets(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      const url = new URL(route.request().url());
      await json(route, url.searchParams.has("cursor")
        ? { assets: [olderAsset], capabilities: { imageGeneration: true }, nextCursor: null }
        : {
            assets: library,
            capabilities: { imageGeneration: true },
            nextCursor: "asset_reference",
          });
      return;
    }
    const uploaded = asset("asset_uploaded", "launch-proof.png");
    library = [uploaded, ...library];
    await json(route, { ok: true, asset: uploaded });
  });
  await page.route(/\/api\/assets\/[^/]+\/content$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route(/\/api\/assets\/asset_uploaded$/, async (route) => {
    expect(route.request().method()).toBe("DELETE");
    library = library.filter((entry) => entry.id !== "asset_uploaded");
    await json(route, { assetId: "asset_uploaded", deleted: true });
  });
  await page.route(/\/api\/content\/items\/item_studio$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.expectedVersion).toBe(studio.contentItem.version);
    if (body.proposalId) expect(body.proposalId).toBe("proposal_master");
    studio = {
      ...studio,
      contentItem: contentItem({
        ...studio.contentItem,
        title: String(body.title),
        objective: String(body.objective),
        coreCopy: String(body.coreCopy),
        brief: String(body.brief),
        version: studio.contentItem.version + 1,
      }),
    };
    await json(route, { contentItem: studio.contentItem });
  });
  await page.route(/\/api\/content\/items\/item_studio\/proposals$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.expectedVersion).toBe(studio.contentItem.version);
    if (body.kind === "master") {
      await json(route, {
        proposal: {
          id: "proposal_master",
          contentItemId: studio.contentItem.id,
          publicationId: null,
          requestId: body.requestId,
          kind: "master",
          platform: null,
          format: null,
          fields: {
            title: "AI-assisted distribution flywheel",
            objective: "Teach founders a repeatable habit",
            brief: "Show one concrete weekly workflow",
            coreCopy: "Turn every product lesson into useful distribution.",
          },
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          status: "proposed",
          createdAt: NOW,
        },
        reused: false,
        credits: 1,
      }, 201);
      return;
    }
    expect(body.platform).toBe("tiktok");
    expect(body.format).toBe("video");
    await json(route, {
      proposal: {
        id: "proposal_variant",
        contentItemId: studio.contentItem.id,
        publicationId: null,
        requestId: body.requestId,
        kind: "variant",
        platform: "tiktok",
        format: "video",
        fields: {
          title: "Stop waiting for launch day",
          body: "Build one distribution habit while you build the product.",
          firstComment: "Which lesson can you share today?",
        },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        status: "proposed",
        createdAt: NOW,
      },
      reused: false,
      credits: 1,
    }, 201);
  });
  await page.route(/\/api\/content\/items\/item_studio\/variants$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.expectedVersion).toBe(studio.contentItem.version);
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.platform).toBe("tiktok");
    expect(body.format).toBe("video");
    expect(body.status).toBe("ready");
    expect(body.proposalId).toBe("proposal_variant");
    const publication: ContentPublicationDto = {
      id: "pub_tiktok",
      contentItemId: studio.contentItem.id,
      channelAccountId: null,
      platform: "tiktok",
      format: "video",
      status: "ready",
      title: String(body.title),
      body: String(body.body),
      firstComment: null,
      linkUrl: null,
      scheduledAt: String(body.scheduledAt),
      publishedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    studio = {
      ...studio,
      contentItem: contentItem({
        ...studio.contentItem,
        status: "review",
        version: studio.contentItem.version + 1,
      }),
      publications: [publication],
    };
    await json(route, { post: { contentItem: studio.contentItem, publication } }, 201);
  });
  await page.route(/\/api\/content\/items\/item_studio\/assets$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.expectedVersion).toBe(studio.contentItem.version);
    expect(body.altText).toBe("Marpin calendar showing a week of founder posts");
    const linked = library.find((entry) => entry.id === body.assetId);
    expect(linked).toBeTruthy();
    const link: ContentItemAssetDto = {
      id: "link_reference",
      position: 0,
      role: "cover",
      altText: String(body.altText),
      asset: linked as ContentAssetDto,
    };
    studio = {
      ...studio,
      contentItem: contentItem({ ...studio.contentItem, version: studio.contentItem.version + 1 }),
      assets: [link],
    };
    await json(route, { contentItem: studio.contentItem, link }, 201);
  });
  await page.route(/\/api\/content\/items\/item_studio\/generate-image$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.expectedVersion).toBe(studio.contentItem.version);
    expect(body.aspectRatio).toBe("1:1");
    expect(body.prompt).toBe("A crisp product calendar on a founder's desk");
    const generated = asset("asset_generated", "gemini-content.png");
    generated.source = "generated";
    library = [generated, ...library];
    const link: ContentItemAssetDto = {
      id: "link_generated",
      position: studio.assets.length,
      role: "media",
      altText: String(body.altText),
      asset: generated,
    };
    studio = {
      ...studio,
      contentItem: contentItem({ ...studio.contentItem, version: studio.contentItem.version + 1 }),
      assets: [...studio.assets, link],
    };
    await json(route, {
      contentItem: studio.contentItem,
      link,
      usage: { credits: 4, remaining: 12 },
    }, 201);
  });

  await page.goto("/app?mode=organic&view=studio");
  await expect(page.getByRole("heading", { name: "Content Studio" })).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=studio(?:&|$)/);
  await expect(page).not.toHaveURL(/organicView=/);

  await page.getByLabel("Title", { exact: true }).fill("The solo founder distribution flywheel");
  await page.getByLabel("Objective", { exact: true }).fill("Turn product lessons into demand");
  await page.getByRole("button", { name: "Save master" }).click();
  await expect(page.getByRole("heading", { name: "The solo founder distribution flywheel" })).toBeVisible();

  await page.getByRole("button", { name: "Draft with AI" }).click();
  const masterProposal = page.getByRole("region", { name: "AI copy proposal" });
  await expect(masterProposal.getByText("AI-assisted distribution flywheel", { exact: true })).toBeVisible();
  await masterProposal.getByRole("button", { name: "Use draft" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Founder-edited AI distribution flywheel");
  await page.getByRole("button", { name: "Save master" }).click();
  await expect(page.getByRole("heading", { name: "Founder-edited AI distribution flywheel" })).toBeVisible();

  await page.getByRole("button", { name: "Load more media" }).click();
  await expect(page.getByRole("button", { name: "Attach older-proof.png" })).toBeVisible();

  await page.getByRole("button", { name: "Add variant" }).click();
  let dialog = page.getByRole("dialog", { name: "Add variant" });
  await expect(dialog.getByRole("button", { name: "Close variant editor" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
  await page.getByRole("button", { name: "Add variant" }).click();
  dialog = page.getByRole("dialog", { name: "Add variant" });
  await dialog.getByLabel("Platform").selectOption("tiktok");
  await dialog.getByRole("button", { name: "Generate with AI" }).click();
  const variantProposal = dialog.getByRole("region", { name: "AI copy proposal" });
  await expect(variantProposal.getByText("Build one distribution habit while you build the product.", { exact: true })).toBeVisible();
  await variantProposal.getByRole("button", { name: "Use draft" }).click();
  await dialog.getByLabel("Copy").fill("Ship one useful product lesson every day and let demand compound.");
  await dialog.getByLabel("Date").fill("2026-07-27");
  await dialog.getByLabel("Time").fill("09:30");
  await dialog.getByLabel("Status").selectOption("ready");
  await dialog.getByRole("button", { name: "Save variant" }).click();
  await expect(page.getByText("TikTok · video", { exact: true })).toBeVisible();
  await expect(page.getByText("Planned", { exact: true })).toBeVisible();

  await page.getByLabel("Title", { exact: true }).fill("Unsaved while arranging media");
  await page.getByLabel("Alt text for next attachment").fill(
    "Marpin calendar showing a week of founder posts",
  );
  await page.getByRole("button", { name: "Attach reference.png" }).click();
  await expect(page.getByAltText("Marpin calendar showing a week of founder posts")).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Unsaved while arranging media");

  await page.getByRole("button", { name: "AI visual" }).click();
  const imageDialog = page.getByRole("dialog", { name: "Generate visual" });
  await imageDialog.getByLabel("Creative direction").fill(
    "A crisp product calendar on a founder's desk",
  );
  await imageDialog.getByLabel("Aspect ratio").selectOption("1:1");
  await imageDialog.getByLabel("Alt text").fill("Generated Marpin content calendar");
  await imageDialog.getByRole("button", { name: "Generate · 4 credits" }).click();
  await expect(page.getByAltText("Generated Marpin content calendar")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "launch-proof.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByRole("button", { name: "Attach launch-proof.png" })).toBeVisible();
  await page.getByRole("button", { name: "Delete launch-proof.png" }).click();
  await page.getByRole("button", { name: "Confirm delete launch-proof.png" }).click();
  await expect(page.getByRole("button", { name: "Attach launch-proof.png" })).toHaveCount(0);

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const discardDialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByRole("heading", { name: "Content planner" })).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=calendar(?:&|$)/);
  await expect(page).not.toHaveURL(/organicView=/);
  await expect.poll(() => calendarLoads).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Next week", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Edit Stop waiting for launch day on TikTok/ }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Content Studio" })).toBeVisible();
});

test("new content and variant retries keep one stable request identity", async ({ page }) => {
  await mockShell(page);
  const itemRequests: Array<Record<string, unknown>> = [];
  const variantRequests: Array<Record<string, unknown>> = [];
  let created: ContentStudioItemDto | null = null;

  await page.route(/\/api\/content\/items\?brandId=.*/, (route) =>
    json(route, { items: created ? [created] : [], nextCursor: null }),
  );
  await page.route(/\/api\/assets(?:\?.*)?$/, (route) =>
    json(route, { assets: [], capabilities: { imageGeneration: false }, nextCursor: null }),
  );
  await page.route(/\/api\/content\/items$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    itemRequests.push(body);
    if (itemRequests.length === 1) {
      await json(route, { error: "temporarily_unavailable", message: "Temporary content save problem" }, 503);
      return;
    }
    created = {
      contentItem: contentItem({
        id: "item_retry",
        title: String(body.title),
        status: String(body.status) as ContentItemDto["status"],
      }),
      publications: [],
      assets: [],
    };
    await json(route, { contentItem: created.contentItem }, 201);
  });
  await page.route(/\/api\/content\/items\/item_retry\/variants$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    variantRequests.push(body);
    if (variantRequests.length === 1) {
      await json(route, { error: "temporarily_unavailable", message: "Temporary variant save problem" }, 503);
      return;
    }
    const updatedItem = contentItem({
      ...created?.contentItem,
      id: "item_retry",
      status: "draft",
      version: 2,
    });
    const publication: ContentPublicationDto = {
      id: "pub_retry",
      contentItemId: "item_retry",
      channelAccountId: null,
      platform: String(body.platform),
      format: String(body.format),
      status: "draft",
      title: null,
      body: String(body.body),
      firstComment: null,
      linkUrl: null,
      scheduledAt: null,
      publishedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    await json(route, { post: { contentItem: updatedItem, publication } }, 201);
  });

  await page.goto("/app?mode=organic&view=studio");
  await page.getByRole("button", { name: "Create first idea" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Retry-safe founder lesson");
  await page.getByRole("button", { name: "Save master" }).click();
  await expect(page.getByText("Temporary content save problem", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save master" }).click();
  await expect(page.getByRole("heading", { name: "Retry-safe founder lesson" })).toBeVisible();

  expect(itemRequests).toHaveLength(2);
  expect(itemRequests[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(itemRequests[1].requestId).toBe(itemRequests[0].requestId);

  await page.getByRole("button", { name: "Add variant" }).click();
  const dialog = page.getByRole("dialog", { name: "Add variant" });
  await dialog.getByLabel("Copy").fill("One useful lesson, retried exactly once.");
  await dialog.getByRole("button", { name: "Save variant" }).click();
  await expect(dialog.getByText("Temporary variant save problem", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Save variant" }).click();
  await expect(dialog).toHaveCount(0);

  expect(variantRequests).toHaveLength(2);
  expect(variantRequests[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(variantRequests[1].requestId).toBe(variantRequests[0].requestId);
});

test("large media uses a private direct upload instead of the server multipart route", async ({ page }) => {
  await mockShell(page);
  const studio: ContentStudioItemDto = {
    contentItem: contentItem(),
    publications: [],
    assets: [],
  };
  const uploaded = asset("asset_large", "founder-demo.png");
  uploaded.bytes = 4 * 1024 * 1024 + 64;
  let multipartPosts = 0;
  let directPuts = 0;
  let completionPosts = 0;

  await page.route(/\/api\/content\/items\?brandId=.*/, (route) => json(route, { items: [studio] }));
  await page.route(/\/api\/assets(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") multipartPosts += 1;
    await json(route, { assets: [], capabilities: { imageGeneration: false }, nextCursor: null });
  });
  await page.route(/\/api\/assets\/reservations$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.filename).toBe("founder-demo.png");
    expect(body.bytes).toBe(uploaded.bytes);
    expect(body.mimeType).toBe("image/png");
    await json(route, {
      reservationId: "reservation_large",
      pathname: "ws/workspace/reservation_large/founder-demo.png",
      uploadUrl: "https://blob-upload.test/private-upload",
    }, 201);
  });
  await page.route("https://blob-upload.test/**", async (route) => {
    const method = route.request().method();
    if (method === "PUT") {
      directPuts += 1;
      expect(route.request().headers()["content-type"]).toBe("image/png");
    }
    await route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "PUT, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
      body: "",
    });
  });
  await page.route(/\/api\/assets\/reservations\/reservation_large\/complete$/, async (route) => {
    completionPosts += 1;
    expect(route.request().postDataJSON()).toEqual({
      pathname: "ws/workspace/reservation_large/founder-demo.png",
    });
    await json(route, { asset: uploaded }, 201);
  });
  await page.route(/\/api\/assets\/asset_large\/content$/, (route) =>
    route.fulfill({ status: 404 }),
  );

  await page.goto("/app?mode=organic&view=studio");
  const bytes = Buffer.alloc(uploaded.bytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  await page.locator('input[type="file"]').setInputFiles({
    name: "founder-demo.png",
    mimeType: "image/png",
    buffer: bytes,
  });
  await expect(page.getByRole("button", { name: "Attach founder-demo.png" })).toBeVisible();
  expect(multipartPosts).toBe(0);
  expect(directPuts).toBe(1);
  expect(completionPosts).toBe(1);
});

test("editing approved master copy requires a separate explicit approval", async ({ page }) => {
  await mockShell(page);
  let item = contentItem({
    status: "approved",
    approvedBy: "owner_1",
    approvedAt: NOW,
  });
  let patchCalls = 0;
  await page.route(/\/api\/content\/items\?brandId=.*/, (route) =>
    json(route, { items: [{ contentItem: item, publications: [], assets: [] }] }),
  );
  await page.route(/\/api\/assets(?:\?.*)?$/, (route) =>
    json(route, { assets: [], capabilities: { imageGeneration: false }, nextCursor: null }),
  );
  await page.route(/\/api\/content\/items\/item_studio$/, async (route) => {
    patchCalls += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.expectedVersion).toBe(item.version);
    if (patchCalls === 1) {
      expect(body.title).toBe("A revised approved founder proof");
      expect(body.status).toBe("review");
      expect(body.approvalIntent).toBeUndefined();
      item = contentItem({
        ...item,
        title: String(body.title),
        status: "review",
        version: 2,
        approvedBy: null,
        approvedAt: null,
      });
    } else {
      expect(Object.keys(body).sort()).toEqual([
        "approvalIntent",
        "expectedVersion",
        "status",
      ]);
      expect(body.status).toBe("approved");
      expect(body.approvalIntent).toBe(true);
      item = contentItem({
        ...item,
        status: "approved",
        version: 3,
        approvedBy: "owner_1",
        approvedAt: "2026-07-20T09:00:00.000Z",
      });
    }
    await json(route, { contentItem: item });
  });

  await page.goto("/app?mode=organic&view=studio");
  const masterStatus = page.getByRole("combobox", { name: "Status", exact: true });
  await expect(masterStatus).toHaveValue("approved");
  await page.getByLabel("Title", { exact: true }).fill("A revised approved founder proof");
  await expect(masterStatus).toHaveValue("review");
  const approveButton = page.getByRole("button", { name: "Approve", exact: true });
  await expect(approveButton).toHaveCount(0);
  await page.getByRole("button", { name: "Save master" }).click();
  await expect(approveButton).toBeVisible();
  await approveButton.click();
  await expect(masterStatus).toHaveValue("approved");
  await expect(approveButton).toHaveCount(0);
  expect(patchCalls).toBe(2);
});

test("media-library failure stays visible and retries without hiding content", async ({ page }) => {
  await mockShell(page);
  const studio: ContentStudioItemDto = {
    contentItem: contentItem(),
    publications: [],
    assets: [],
  };
  let assetLoads = 0;
  await page.route(/\/api\/content\/items\?brandId=.*/, (route) => json(route, { items: [studio] }));
  await page.route(/\/api\/assets(?:\?.*)?$/, async (route) => {
    assetLoads += 1;
    if (assetLoads === 1) {
      await json(route, { error: "asset_library_unavailable", message: "Media service unavailable." }, 503);
      return;
    }
    await json(route, {
      assets: [asset("asset_recovered", "recovered.png")],
      capabilities: { imageGeneration: false },
      nextCursor: null,
    });
  });
  await page.route(/\/api\/assets\/asset_recovered\/content$/, (route) => route.fulfill({ status: 404 }));

  await page.goto("/app?mode=organic&view=studio");
  await expect(page.getByRole("heading", { name: "Distribution before launch" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Media service unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByText("0 attached · library unavailable", { exact: true })).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Unsaved founder edit");
  await expect(page.getByRole("button", { name: "Dismiss Content Studio error" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upload media" })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry media" }).click();
  await expect(page.getByRole("button", { name: "Attach recovered.png" })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Unsaved founder edit");
  expect(assetLoads).toBe(2);
});

test("review content is visibly locked for members and Studio fits a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShell(page, false);
  const reviewed: ContentStudioItemDto = {
    contentItem: contentItem({ status: "review" }),
    publications: [],
    assets: [],
  };
  await page.route(/\/api\/content\/items\?brandId=.*/, (route) => json(route, { items: [reviewed] }));
  await page.route(/\/api\/assets(?:\?.*)?$/, (route) => json(route, { assets: [asset()] }));
  await page.route(/\/api\/assets\/[^/]+\/content$/, (route) => route.fulfill({ status: 404 }));

  await page.goto("/app?mode=organic&view=studio");
  await expect(page.getByRole("heading", { name: "Content Studio" })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add variant" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /reference\.png/ })).toBeDisabled();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("a stale Studio edit offers a one-click reload of the latest server version", async ({ page }) => {
  await mockShell(page);
  let serverItem: ContentStudioItemDto = {
    contentItem: contentItem(),
    publications: [],
    assets: [],
  };
  let itemLoads = 0;

  await page.route(/\/api\/content\/items\?brandId=.*/, async (route) => {
    itemLoads += 1;
    await json(route, { items: [serverItem] });
  });
  await page.route(/\/api\/assets(?:\?.*)?$/, (route) =>
    json(route, { assets: [], capabilities: { imageGeneration: false } }),
  );
  await page.route(/\/api\/content\/items\/item_studio$/, async (route) => {
    serverItem = {
      ...serverItem,
      contentItem: contentItem({
        ...serverItem.contentItem,
        title: "Latest title from another editor",
        version: 2,
      }),
    };
    await json(route, {
      error: "version_conflict",
      message: "This content changed in another session.",
      currentVersion: 2,
    }, 409);
  });

  await page.goto("/app?mode=organic&view=studio");
  await page.getByLabel("Title", { exact: true }).fill("My stale edit");
  await page.getByRole("button", { name: "Save master" }).click();

  await expect(page.getByText("This content changed in another session.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reload latest" }).click();
  await expect(page.getByRole("heading", { name: "Latest title from another editor" })).toBeVisible();
  expect(itemLoads).toBeGreaterThanOrEqual(2);
});

test("a version conflict inside the variant modal keeps recovery inside the focus trap", async ({ page }) => {
  await mockShell(page);
  let serverItem: ContentStudioItemDto = {
    contentItem: contentItem(),
    publications: [],
    assets: [],
  };
  let itemLoads = 0;
  await page.route(/\/api\/content\/items\?brandId=.*/, async (route) => {
    itemLoads += 1;
    await json(route, { items: [serverItem] });
  });
  await page.route(/\/api\/assets(?:\?.*)?$/, (route) =>
    json(route, { assets: [], capabilities: { imageGeneration: false }, nextCursor: null }),
  );
  await page.route(/\/api\/content\/items\/item_studio\/variants$/, async (route) => {
    serverItem = {
      ...serverItem,
      contentItem: contentItem({
        ...serverItem.contentItem,
        title: "Latest master from another editor",
        version: 2,
      }),
    };
    await json(route, {
      error: "version_conflict",
      message: "This content changed in another session.",
      currentVersion: 2,
    }, 409);
  });

  await page.goto("/app?mode=organic&view=studio");
  await page.getByRole("button", { name: "Add variant" }).click();
  const dialog = page.getByRole("dialog", { name: "Add variant" });
  await dialog.getByLabel("Copy").fill("My stale channel copy");
  await dialog.getByRole("button", { name: "Save variant" }).click();
  await expect(dialog.getByText("This content changed in another session.", { exact: true })).toBeVisible();
  const reload = dialog.getByRole("button", { name: "Reload latest" });
  await expect(reload).toBeVisible();
  await reload.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Latest master from another editor" })).toBeVisible();
  expect(itemLoads).toBeGreaterThanOrEqual(2);
});

test("unsaved master edits are guarded across selection, new ideas, calendar navigation, and unload", async ({ page }) => {
  await mockShell(page);
  const first: ContentStudioItemDto = {
    contentItem: contentItem({ id: "item_first", title: "First founder idea" }),
    publications: [],
    assets: [],
  };
  const second: ContentStudioItemDto = {
    contentItem: contentItem({ id: "item_second", title: "Second founder idea" }),
    publications: [],
    assets: [],
  };
  await page.route(/\/api\/content\/items\?brandId=.*/, (route) =>
    json(route, { items: [first, second], nextCursor: null }),
  );
  await page.route(/\/api\/assets(?:\?.*)?$/, (route) =>
    json(route, { assets: [], capabilities: { imageGeneration: false }, nextCursor: null }),
  );

  await page.goto("/app?mode=organic&view=studio");
  const title = page.getByLabel("Title", { exact: true });
  await expect(title).toHaveValue("First founder idea");
  await title.fill("Unsaved founder revision");

  const unload = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    const dispatchResult = window.dispatchEvent(event);
    return { defaultPrevented: event.defaultPrevented, dispatchResult };
  });
  expect(unload).toEqual({ defaultPrevented: true, dispatchResult: false });

  await page.getByRole("button", { name: /Second founder idea/ }).click();
  let dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(title).toHaveValue("Unsaved founder revision");

  await page.getByRole("button", { name: "New idea" }).click();
  dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(title).toHaveValue("Unsaved founder revision");

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Content Studio" })).toBeVisible();
  await expect(title).toHaveValue("Unsaved founder revision");

  await page.getByRole("button", { name: /Second founder idea/ }).click();
  dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await dialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(title).toHaveValue("Second founder idea");
});

test("content pagination loads older ideas once and keeps the current unsaved editor selected", async ({ page }) => {
  await mockShell(page);
  const newest: ContentStudioItemDto = {
    contentItem: contentItem({ id: "item_newest", title: "Newest idea" }),
    publications: [],
    assets: [],
  };
  const older: ContentStudioItemDto = {
    contentItem: contentItem({ id: "item_older", title: "Older reusable idea" }),
    publications: [],
    assets: [],
  };
  const cursors: Array<string | null> = [];
  await page.route(/\/api\/content\/items\?brandId=.*/, async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    await json(route, cursor
      ? { items: [newest, older], nextCursor: null }
      : { items: [newest], nextCursor: "content-page-2" });
  });
  await page.route(/\/api\/assets(?:\?.*)?$/, (route) =>
    json(route, { assets: [], capabilities: { imageGeneration: false }, nextCursor: null }),
  );

  await page.goto("/app?mode=organic&view=studio");
  const title = page.getByLabel("Title", { exact: true });
  await expect(title).toHaveValue("Newest idea");
  await title.fill("Unsaved newest revision");
  await page.getByRole("button", { name: "Load more content" }).click();

  await expect(page.getByRole("button", { name: /Older reusable idea/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Newest idea/ })).toHaveCount(1);
  await expect(title).toHaveValue("Unsaved newest revision");
  await expect(page.getByRole("button", { name: "Load more content" })).toHaveCount(0);
  expect(cursors.filter((cursor) => cursor === "content-page-2")).toHaveLength(1);
  expect(cursors.at(-1)).toBe("content-page-2");
});
