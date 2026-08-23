import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/connections(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ workspace: { name: "Browser Test Workspace" }, connections: [] }),
    });
  });
  await page.route(/\/api\/brands(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true, brands: [] }),
    });
  });
  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true, conversations: [] }),
    });
  });
});

test("Stop preserves partial work and Retry starts exactly one fresh request", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let chatRequests = 0;
    Object.defineProperty(window, "__marpinChatRequests", {
      get: () => chatRequests,
    });
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.endsWith("/api/chat")) return originalFetch(input, init);

      chatRequests += 1;
      const requestNumber = chatRequests;
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (delay: number, event: object) => {
            window.setTimeout(() => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              } catch {
                // This fixture intentionally ignores AbortSignal so an old stream
                // can misbehave after Stop and exercise the request gate.
              }
            }, delay);
          };
          send(0, { type: "start", question: "test" });
          send(20, {
            type: "text-delta",
            text: requestNumber === 1 ? "first partial" : "fresh retry",
          });
          if (requestNumber === 1) {
            // Continue emitting only after Stop aborts the request. This keeps the
            // stale-frame race deterministic even when the first dev compile is
            // slow, while still simulating a transport that ignores cancellation.
            init?.signal?.addEventListener(
              "abort",
              () => {
                send(120, { type: "text-delta", text: " STALE_OLD_STREAM" });
                send(220, { type: "done" });
              },
              { once: true },
            );
          } else {
            send(900, { type: "done" });
          }
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };
  });

  await page.goto("/app");
  await page.getByRole("textbox", { name: "Enter your website URL" }).fill("Plan an organic launch for a developer tool");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible();
  const response = page.getByTestId("assistant-response");
  await expect(response).toContainText("first partial");
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect(page.getByTestId("chat-error")).toContainText("Stopped");
  const stoppedPartial = await response.innerText();
  expect(stoppedPartial.length).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  await expect(response).toHaveText(stoppedPartial);

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible();
  await expect(response).toContainText("fresh retry");
  await page.waitForTimeout(700);
  await expect(response).not.toContainText("STALE_OLD_STREAM");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __marpinChatRequests?: number }).__marpinChatRequests ?? 0,
      ),
    )
    .toBe(2);
});

test("typed transport failures are visible and recoverable", async ({ page }) => {
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"type":"start","question":"test"}\n\ndata: malformed\n\n',
    });
  });
  await page.goto("/app");
  await page.getByRole("textbox", { name: "Enter your website URL" }).fill("Explain CTR");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByTestId("chat-error")).toContainText("malformed response");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("rate limits and incomplete streams become typed alerts", async ({ page }) => {
  let responseKind: "rate" | "incomplete" = "rate";
  await page.route("**/api/chat", async (route) => {
    if (responseKind === "rate") {
      await route.fulfill({ status: 429, body: "rate limit exceeded" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"type":"start","question":"test"}\n\ndata: {"type":"text-delta","text":"partial"}\n\n',
    });
  });
  await page.goto("/app");
  const input = page.getByRole("textbox", { name: "Enter your website URL" });
  await input.fill("Explain paid media");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByTestId("chat-error")).toContainText("too many requests");

  responseKind = "incomplete";
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("chat-error")).toContainText("ended before Marpin finished");
});

test("connections restore focus, reduced motion is honored, and axe has no serious violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/app");
  const manage = page.getByRole("button", { name: "Manage connections" });
  await manage.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Manage connections" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Manage connections" })).toBeHidden();
  await expect(manage).toBeFocused();

  const reduced = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "animate-pulse";
    document.body.appendChild(probe);
    const duration = getComputedStyle(probe).animationDuration;
    probe.remove();
    return duration;
  });
  expect(["0.01ms", "0.00001s", "1e-05s"]).toContain(reduced);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
});

test("mobile workspace settles without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => document.querySelector("aside")?.getBoundingClientRect().width)).toBe(64);
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    inputWidth: document.querySelector("textarea")?.getBoundingClientRect().width ?? 0,
  }));
  expect(layout.overflow).toBe(0);
  expect(layout.inputWidth).toBeGreaterThan(220);
});
