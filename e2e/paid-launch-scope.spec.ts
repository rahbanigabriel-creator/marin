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

test("launch has three work areas and paid chat preserves the active conversation", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const requests = await setup(page);
  await page.goto("/app");
  await expect(page).toHaveURL(/mode=paid&view=campaigns/);
  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(nav.getByRole("button", { name: "Paid campaigns", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("button", { name: "Analytics", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Agents", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: /Assistant|Organic|SEO/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Campaign chat" })).toBeVisible();
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
  await page.screenshot({ path: info.outputPath("paid-chat-desktop.png"), fullPage: true, animations: "disabled" });
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

test("mobile chat is contained, keyboard dismissible, and retains the paid page", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto("/app?mode=paid");
  const open = page.getByRole("button", { name: "Open campaign chat" });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Campaign chat" });
  await expect(dialog).toBeVisible();
  await page.getByPlaceholder("Ask about your campaigns...").fill("Explain ROAS");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByTestId("assistant-response")).toContainText("No ads were changed");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("paid-chat-mobile.png"), fullPage: true, animations: "disabled" });
  const accessibility = await new AxeBuilder({ page }).include("#paid-chat-panel").analyze();
  expect(accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Paid command center" })).toBeVisible();
  await expect(open).toBeFocused();
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
