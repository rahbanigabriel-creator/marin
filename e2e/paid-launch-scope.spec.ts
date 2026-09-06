import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function setup(page: Page) {
  const requests: Array<Record<string, unknown>> = [];
  await page.route(/\/api\/connections(?:\?.*)?$/, (route) => json(route, { workspace: { name: "Marpin QA" }, connections: [
    { name: "Google Analytics 4", platform: "ga4", connectorPlatform: "ga4", category: "measurement", configured: true, status: "disconnected" },
  ] }));
  await page.route(/\/api\/brands(?:\?.*)?$/, (route) => json(route, { brands: [] }));
  await page.route(/\/api\/billing(?:\?.*)?$/, (route) => json(route, { billing: { canManage: true, plan: { name: "Solo" }, entitlements: { canUseOpus: false, maxConnections: 10 }, resources: { connections: 0 } } }));
  await page.route(/\/api\/dashboard(?:\?.*)?$/, (route) => json(route, { mode: "empty", data: { campaigns: [], accounts: [], series: [], platforms: [] } }));
  await page.route(/\/api\/conversations(?:\?.*)?$/, (route) => json(route, { conversations: [{ id: "conversation_saved", title: "Existing campaign review", mode: "assistant", preview: "Review Meta performance" }] }));
  await page.route("**/api/conversations/conversation_saved", (route) => json(route, { conversation: { id: "conversation_saved", title: "Existing campaign review", mode: "assistant", messages: [
    { id: "question_saved", turnId: "turn_saved", role: "user", content: "Review Meta performance" },
    { id: "answer_saved", turnId: "turn_saved", role: "assistant", content: "Your saved review is still available.", metadata: { dataMode: "empty" } },
  ] } }));
  await page.route("**/api/chat", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "text/event-stream", body: [
      { type: "start", question: "Review my campaigns" },
      { type: "text-delta", text: "Here is your campaign review. No ads were changed." },
      { type: "done" },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
  });
  return requests;
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "laptop", width: 1180, height: 820 },
  { name: "in-app pane", width: 900, height: 700 },
  { name: "mobile", width: 390, height: 844 },
  { name: "small mobile", width: 320, height: 568 },
]) {
  test(`campaign chat opens inline by default on ${viewport.name}`, async ({ page }, info) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const requests = await setup(page);
    await page.goto("/app");
    const panel = page.getByRole("complementary", { name: "Campaign chat" });
    const composer = page.getByPlaceholder("Ask about your campaigns...");
    const heading = page.getByRole("heading", { name: "Paid command center" });
    await expect(panel).toBeVisible();
    await expect(heading).toBeInViewport();
    await expect(composer).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Hide campaign chat" })).toHaveAttribute("aria-expanded", "true");
    await expect(panel).not.toHaveAttribute("aria-modal", "true");
    await expect(page.getByRole("dialog", { name: "Campaign chat" })).toHaveCount(0);
    expect(await panel.evaluate((node) => node.contains(document.activeElement))).toBe(false);
    expect(await heading.evaluate((node) => Boolean(node.closest("[inert]")))).toBe(false);
    await expect(panel.getByRole("heading", { name: "What should we work on?" })).toBeInViewport({ ratio: 1 });
    await expect.poll(() => page.getByTestId("paid-chat-messages").evaluate((node) => node.scrollTop)).toBe(0);
    if (viewport.height >= 700) {
      await expect(panel.getByRole("button", { name: "Which campaigns need my attention?", exact: true })).toBeInViewport({ ratio: 1 });
    }

    // Read both panels together while the sidebar may still be animating.
    const { campaignBox, panelBox } = await heading.evaluate((node) => ({
      campaignBox: node.closest("section")!.getBoundingClientRect().toJSON(),
      panelBox: document.getElementById("paid-chat-panel")!.getBoundingClientRect().toJSON(),
    }));
    expect(campaignBox.height).toBeGreaterThanOrEqual(200);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(viewport.width);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(viewport.height);
    if (viewport.width >= 1280) {
      expect(panelBox.x).toBeGreaterThanOrEqual(campaignBox.right);
    } else {
      expect(panelBox.y).toBeGreaterThanOrEqual(campaignBox.bottom);
      expect(panelBox.width).toBeCloseTo(campaignBox.width, 0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "All platforms", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    await page.screenshot({ path: info.outputPath(`paid-chat-${viewport.name.replaceAll(" ", "-")}.png`), fullPage: true, animations: "disabled" });

    const nav = page.getByRole("navigation", { name: "Workspace" });
    await page.goto("/app?mode=analytics");
    await expect(panel).toHaveCount(0);
    await nav.getByRole("button", { name: "Paid campaigns", exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(composer).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: "Close campaign chat" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open campaign chat" })).toBeFocused();
    await nav.getByRole("button", { name: "Analytics", exact: true }).click();
    await nav.getByRole("button", { name: "Paid campaigns", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await page.reload();
    await expect(panel).toBeVisible();
    await expect(composer).toBeInViewport({ ratio: 1 });
    expect(requests).toHaveLength(0);
  });
}

test("launch has three work areas and paid chat preserves the active conversation", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const requests = await setup(page);
  await page.route(/\/api\/brands(?:\?.*)?$/, (route) => json(route, { brands: [{ id: "unrelated_audit", name: "Unrelated saved audit", isPrimary: true }] }));
  await page.goto("/app");
  await expect(page).toHaveURL(/mode=paid&view=campaigns/);
  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(nav.getByRole("button", { name: "Paid campaigns", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("button", { name: "Analytics", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Agents", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: /Assistant|Organic|SEO/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Campaign chat" })).toBeVisible();
  await expect(page.locator("#paid-chat-panel").getByText("Marpin QA", { exact: true })).toBeVisible();
  await expect(page.locator("#paid-chat-panel").getByText("Unrelated saved audit", { exact: true })).toHaveCount(0);
  await page.getByPlaceholder("Ask about your campaigns...").fill("Review my campaigns");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByTestId("assistant-response")).toContainText("Here is your campaign review");
  await expect(page.getByRole("heading", { name: "Paid command center" })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].mode).toBe("paid");
  await page.getByPlaceholder("Ask about your campaigns...").fill("Keep this unfinished question");
  await nav.getByRole("button", { name: "Analytics", exact: true }).click();
  await nav.getByRole("button", { name: "Paid campaigns", exact: true }).click();
  await expect(page.getByTestId("assistant-response")).toContainText("Here is your campaign review");
  await expect(page.getByPlaceholder("Ask about your campaigns...")).toHaveValue("Keep this unfinished question");
  expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "Hide campaign chat" }).click();
  await expect(page.getByRole("heading", { name: "Campaign chat" })).toBeHidden();
  await page.getByRole("button", { name: "Open campaign chat" }).click();
  await expect(page.getByTestId("assistant-response")).toContainText("Here is your campaign review");
  await expect(page.getByPlaceholder("Ask about your campaigns...")).toHaveValue("Keep this unfinished question");
  await page.screenshot({ path: info.outputPath("paid-chat-desktop.png"), fullPage: true, animations: "disabled" });
  for (const width of [1280, 1279, 900, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole("complementary", { name: "Campaign chat" })).toBeVisible();
    await expect(page.getByTestId("assistant-response")).toContainText("Here is your campaign review");
    await expect(page.getByPlaceholder("Ask about your campaigns...")).toHaveValue("Keep this unfinished question");
  }
  await page.getByRole("button", { name: "Hide campaign chat" }).click();
  for (const width of [900, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole("button", { name: "Open campaign chat" })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("complementary", { name: "Campaign chat" })).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Open campaign chat" }).click();
  await expect(page.getByTestId("assistant-response")).toContainText("Here is your campaign review");
  await expect(page.getByPlaceholder("Ask about your campaigns...")).toHaveValue("Keep this unfinished question");
  expect(requests).toHaveLength(1);
});

test("old assistant and hidden organic links return to paid without deleting chat history", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page);
  for (const url of ["/app?mode=organic&view=seo", "/app?mode=organic&view=calendar", "/app?mode=assistant"]) {
    await page.goto(url);
    await expect(page).toHaveURL(/mode=paid&view=campaigns/);
    await expect(page.getByRole("heading", { name: "Paid command center" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Existing campaign review", exact: true }).click();
  await expect(page.getByTestId("assistant-response")).toHaveText("Your saved review is still available.");
  await expect(page.getByRole("heading", { name: "Paid command center" })).toBeVisible();
  await expect(page).toHaveURL(/mode=paid&view=campaigns/);
});

test("connections expose paid platforms and GA4, not SEO or organic providers", async ({ page }) => {
  await setup(page);
  await page.goto("/app");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "Manage connections", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manage connections" });
  await expect(dialog.getByText("Google Analytics 4", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Google Ads", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Meta Ads", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Search Console|Pinterest|TikTok|Reddit/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("healthy Meta access is optional and Google configuration errors need setup, not reconnect", async ({ page }, info) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await setup(page);
  await page.route(/\/api\/billing(?:\?.*)?$/, (route) => json(route, { billing: {
    canManage: true, plan: { name: "Free" }, entitlements: { canUseOpus: false, maxConnections: 1 }, resources: { connections: 1 },
  } }));
  await page.route(/\/api\/connections(?:\?.*)?$/, (route) => json(route, {
    workspace: { name: "Marpin QA" },
    connections: [
      { name: "Meta Ads", platform: "meta_ads", connectorPlatform: "meta_ads", category: "paid", configured: true, status: "connected", connectionId: "healthy_meta", displayName: "Healthy Meta account" },
      { name: "Google Ads", platform: "google_ads", connectorPlatform: "google_ads", category: "paid", configured: true, status: "error", connectionId: "google_setup", errorCode: "configuration" },
    ],
  }));
  await page.goto("/app");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "Manage connections", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manage connections" });
  await expect(dialog.getByText("Connected - Healthy Meta account", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Connected", exact: true })).toBeDisabled();
  const updateMeta = dialog.getByRole("button", { name: "Update Meta Ads access", exact: true });
  await expect(updateMeta).toBeEnabled();
  await expect(updateMeta).toHaveAttribute("title", "Update account access (optional)");
  await expect(dialog.getByRole("button", { name: "Setup needed", exact: true })).toBeDisabled();
  await expect(dialog.getByText("Marpin setup needs attention; reconnecting will not fix it", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Reconnect", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Update Google Ads access", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("connection-access-states.png"), fullPage: true, animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("complementary", { name: "Campaign chat" })).toBeVisible();
});

test("mobile inline chat is keyboard accessible and retains the paid page", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto("/app?mode=paid");
  const panel = page.getByRole("complementary", { name: "Campaign chat" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "New campaign conversation" }).focus();
  await page.keyboard.press("Shift+Tab");
  expect(await panel.evaluate((node) => node.contains(document.activeElement))).toBe(false);
  await page.getByPlaceholder("Ask about your campaigns...").fill("Explain ROAS");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByTestId("assistant-response")).toContainText("No ads were changed");
  const messages = page.getByTestId("paid-chat-messages");
  await expect.poll(() => messages.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => messages.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("paid-chat-mobile.png"), fullPage: true, animations: "disabled" });
  const accessibility = await new AxeBuilder({ page }).include("#paid-chat-panel").analyze();
  expect(accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  await page.getByPlaceholder("Ask about your campaigns...").fill("Keep this mobile draft");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.getByRole("heading", { name: "Paid command center" })).toBeVisible();
  const open = page.getByRole("button", { name: "Open campaign chat" });
  await expect(open).toBeFocused();
  await open.click();
  await expect(page.getByTestId("assistant-response")).toContainText("No ads were changed");
  await expect(page.getByPlaceholder("Ask about your campaigns...")).toHaveValue("Keep this mobile draft");
  await panel.getByRole("button", { name: "New campaign conversation" }).click();
  await expect(panel.getByRole("heading", { name: "What should we work on?" })).toBeInViewport({ ratio: 1 });
  await expect.poll(() => messages.evaluate((node) => node.scrollTop)).toBe(0);
});

test("stopping a paid response preserves partial work and retry rejects stale frames", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page);
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let requests = 0;
    Object.defineProperty(window, "__paidChatRequests", { get: () => requests });
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.endsWith("/api/chat")) return originalFetch(input, init);
      const request = ++requests;
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: object) => {
            try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { /* The stale stream intentionally ignores cancellation. */ }
          };
          send({ type: "start", question: "Review my campaigns" });
          send({ type: "text-delta", text: request === 1 ? "Partial review" : "Fresh review" });
          if (request === 1) {
            init?.signal?.addEventListener("abort", () => {
              window.setTimeout(() => {
                send({ type: "text-delta", text: " STALE_RESPONSE" });
                send({ type: "done" });
              }, 120);
            }, { once: true });
          } else {
            send({ type: "done" });
            controller.close();
          }
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    };
  });
  await page.goto("/app");
  await page.getByPlaceholder("Ask about your campaigns...").fill("Review my campaigns");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByTestId("assistant-response")).toContainText("Partial review");
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect(page.getByTestId("chat-error")).toContainText("Stopped");
  await expect(page.getByTestId("assistant-response")).toContainText("Partial review");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByTestId("assistant-response")).toContainText("Fresh review");
  await page.waitForTimeout(250);
  await expect(page.getByTestId("assistant-response")).not.toContainText("STALE_RESPONSE");
  expect(await page.evaluate(() => (window as Window & { __paidChatRequests?: number }).__paidChatRequests)).toBe(2);
});

test("reselecting the active chat cancels a delayed history switch without clearing its draft", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/conversations/conversation_saved", async (route) => {
    await pending;
    await json(route, { conversation: { id: "conversation_saved", title: "Wrong delayed chat", mode: "assistant", messages: [
      { id: "u", turnId: "t", role: "user", content: "Wrong delayed question" },
      { id: "a", turnId: "t", role: "assistant", content: "Wrong delayed answer" },
    ] } });
  });
  await page.goto("/app");
  await page.getByPlaceholder("Ask about your campaigns...").fill("Keep active chat");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByTestId("assistant-response")).toContainText("Here is your campaign review");
  await page.getByPlaceholder("Ask about your campaigns...").fill("Unsent draft");
  await page.getByRole("button", { name: "Existing campaign review", exact: true }).click();
  await expect(page.getByText("Loading conversation...", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keep active chat", exact: true }).click();
  const completed = page.waitForResponse("**/api/conversations/conversation_saved");
  release();
  await completed;
  await expect(page.getByText("Loading conversation...", { exact: true })).toBeHidden();
  await expect(page.getByTestId("assistant-response")).toContainText("Here is your campaign review");
  await expect(page.getByPlaceholder("Ask about your campaigns...")).toHaveValue("Unsent draft");
});

test("read-only saved chat keeps sample warnings and disables retry and clarification commands", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const requests = await setup(page);
  await page.route(/\/api\/billing(?:\?.*)?$/, (route) => json(route, { billing: { canManage: false, entitlements: {} } }));
  await page.route("**/api/conversations/conversation_saved", (route) => json(route, { conversation: {
    id: "conversation_saved", title: "Saved sample", mode: "assistant", messages: [
      { id: "u", turnId: "t", role: "user", content: "Review sample" },
      { id: "a", turnId: "t", role: "assistant", content: "", metadata: { dataMode: "sample", choices: [{ question: "Which account?", options: ["Sample account"] }] } },
    ],
  } }));
  await page.goto("/app");
  await page.getByRole("button", { name: "Existing campaign review", exact: true }).click();
  await expect(page.getByText(/Sample data. This saved analysis/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sample account", exact: true })).toBeDisabled();
  expect(requests).toHaveLength(0);
});

test("chat actions preserve the campaign drafts URL", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page);
  await page.goto("/app?mode=paid&view=campaigns&paidView=drafts");
  await page.getByRole("button", { name: "New campaign conversation", exact: true }).click();
  await expect(page).toHaveURL(/paidView=drafts/);
  await page.getByRole("button", { name: "Existing campaign review", exact: true }).click();
  await expect(page.getByTestId("assistant-response")).toContainText("Your saved review is still available");
  await expect(page).toHaveURL(/paidView=drafts/);
});
