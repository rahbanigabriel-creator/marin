import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import type { BrandDto } from "../src/lib/brand/types";
import type {
  ConversationDto,
  ConversationSummaryDto,
} from "../src/lib/conversations/types";

const NOW = "2026-07-20T10:00:00.000Z";

function auditedBrand(version: number): BrandDto {
  return {
    id: "brand_1",
    name: version === 1 ? "Marpin" : "Marpin Distribution OS",
    websiteUrl: "https://www.marpin.ai/",
    isPrimary: true,
    summary:
      version === 1
        ? "AI marketing support for founders."
        : "The distribution operating system for solo software founders.",
    audience: version === 1 ? ["Software founders"] : ["Solo software founders", "Technical indie hackers"],
    voice: version === 1 ? ["Clear"] : ["Direct", "Evidence-led", "Practical"],
    offers: ["A whole marketing team, in one chat"],
    competitors: [],
    proofPoints: [],
    visualStyle: [],
    locale: version === 1 ? "en" : "en-ES",
    timezone: "Europe/Madrid",
    currency: "EUR",
    contextVersion: version,
    auditSnapshot: {
      score: 92,
      findings: [
        {
          title: "Meta description length needs attention",
          severity: "warning",
          recommendation: "Tighten the description around the founder outcome.",
        },
      ],
    },
    auditedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

test("website audit becomes durable Brand memory and restores contextual work without rerunning AI", async ({ page }) => {
  let brand: BrandDto | null = null;
  let conversations: ConversationSummaryDto[] = [];
  let conversation: ConversationDto | null = null;
  let chatRequests = 0;

  await page.route(/\/api\/connections(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspace: { name: "Solo Founder Workspace" },
        connections: [],
      }),
    });
  });
  await page.route(/\/api\/billing(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        billing: {
          canManage: true,
          entitlements: { canUseOpus: false },
          resources: { connections: 0 },
        },
      }),
    });
  });
  await page.route(/\/api\/content\/calendar(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        calendar: {
          timezone: "Europe/Madrid",
          plans: [],
          contentItems: [],
          publications: [],
        },
      }),
    });
  });

  await page.route(/\/api\/brands(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true, brands: brand ? [brand] : [] }),
    });
  });

  await page.route(/\/api\/brands\/audit(?:\?.*)?$/, async (route) => {
    brand = auditedBrand(1);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ brand, audit: brand.auditSnapshot }),
    });
  });

  await page.route(/\/api\/brands\/brand_1(?:\?.*)?$/, async (route) => {
    const input = route.request().postDataJSON() as Partial<BrandDto>;
    brand = { ...auditedBrand(2), ...input, contextVersion: 2, updatedAt: NOW };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ brand }),
    });
  });

  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true, conversations }),
    });
  });

  await page.route(/\/api\/conversations\/conversation_1(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: conversation ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(conversation ? { conversation } : { error: "not_found" }),
    });
  });

  await page.route("**/api/chat", async (route) => {
    chatRequests += 1;
    const request = route.request().postDataJSON() as {
      question: string;
      turnId: string;
      mode: string;
    };
    const answer = "Here is a focused week of organic distribution for Marpin.";
    const brief = {
      kind: "brief" as const,
      data: {
        label: "ORGANIC",
        title: "Marpin's founder-led distribution week",
        subtitle: "One thesis, adapted to each channel.",
        sections: [
          { heading: "Monday", points: ["Publish the founder insight on LinkedIn and X."] },
          { heading: "Wednesday", points: ["Turn the same thesis into a short product video."] },
        ],
        cta: "Review the calendar before scheduling.",
      },
    };
    const summary: ConversationSummaryDto = {
      id: "conversation_1",
      brandId: "brand_1",
      title: "Plan next week's organic distribution",
      mode: "organic",
      status: "active",
      lastMessageAt: NOW,
      updatedAt: NOW,
      preview: request.question,
    };
    conversations = [summary];
    conversation = {
      ...summary,
      messages: [
        {
          id: "message_user_1",
          turnId: request.turnId,
          role: "user",
          content: request.question,
          metadata: null,
          createdAt: NOW,
        },
        {
          id: "message_assistant_1",
          turnId: request.turnId,
          role: "assistant",
          content: answer,
          metadata: { artifacts: [brief], dataMode: "empty" },
          createdAt: NOW,
        },
      ],
    };

    const events = [
      { type: "start", question: request.question },
      { type: "conversation", id: summary.id, title: summary.title },
      { type: "phase", step: 7 },
      { type: "data-mode", mode: "empty" },
      { type: "text-delta", text: answer },
      { type: "artifact", payload: brief },
      { type: "done" },
    ];
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    });
  });

  await page.goto("/app");
  const firstRunInput = page.getByRole("textbox", { name: "Enter your website URL" });
  await expect(firstRunInput).toBeVisible();
  await firstRunInput.fill("https://www.marpin.ai");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("heading", { name: "Marpin", exact: true })).toBeVisible();
  await expect(page.getByText("BRAND MEMORY · VERSION 1")).toBeVisible();
  await expect(page.getByText("Meta description length needs attention")).toBeVisible();

  await page.getByRole("textbox", { name: "Brand name" }).fill("Marpin Distribution OS");
  await page
    .getByRole("textbox", { name: "Positioning summary" })
    .fill("The distribution operating system for solo software founders.");
  await page
    .getByRole("textbox", { name: /audience/i })
    .fill("Solo software founders\nTechnical indie hackers");
  await page.getByRole("textbox", { name: /voice/i }).fill("Direct\nEvidence-led\nPractical");
  await page.getByRole("textbox", { name: "Locale" }).fill("en-ES");
  await page.getByRole("button", { name: "Save brand" }).click();
  await expect(page.getByText("BRAND MEMORY · VERSION 2")).toBeVisible();

  await page.reload();
  await expect(page.getByText("BRAND MEMORY · VERSION 2")).toBeVisible();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "What should we work on for Marpin Distribution OS?" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ask Marpin what to do next" })).toBeVisible();

  await page.getByRole("button", { name: "Brand", exact: true }).click();
  await expect(page.getByText("BRAND MEMORY · VERSION 2")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Brand name" })).toHaveValue("Marpin Distribution OS");
  await expect(page.getByRole("textbox", { name: /audience/i })).toHaveValue(
    "Solo software founders\nTechnical indie hackers",
  );

  await page.getByRole("button", { name: "Organic + SEO", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Content planner" })).toBeVisible();
  await page.getByRole("button", { name: "Ask assistant" }).first().click();
  await expect(page.getByTestId("assistant-response")).toContainText(
    "Here is a focused week of organic distribution for Marpin.",
  );
  await expect(page.getByText("Marpin's founder-led distribution week")).toBeVisible();
  await expect.poll(() => chatRequests).toBe(1);

  await page.reload();
  await page
    .getByRole("button", { name: "Plan next week's organic distribution", exact: true })
    .click();
  await expect(page.getByTestId("assistant-response")).toContainText(
    "Here is a focused week of organic distribution for Marpin.",
  );
  await expect(page.getByText("Marpin's founder-led distribution week")).toBeVisible();
  expect(chatRequests).toBe(1);
});

test("workspace members can inspect brand memory without mutating shared context", async ({ page }) => {
  await page.route(/\/api\/connections(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ workspace: { name: "Member workspace" }, connections: [] }),
    }),
  );
  await page.route(/\/api\/billing(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        billing: {
          canManage: false,
          entitlements: { canUseOpus: false },
          resources: { connections: 0 },
        },
      }),
    }),
  );
  await page.route(/\/api\/brands(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true, brands: [auditedBrand(1)] }),
    }),
  );
  await page.route(/\/api\/conversations(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true, conversations: [] }),
    }),
  );

  await page.goto("/app?mode=brand");
  await expect(page.getByText("Read-only · owner or admin access is required")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Brand name" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Re-audit" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save brand" })).toBeDisabled();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    ),
  ).toEqual([]);
});

test("Brand memory remains usable without horizontal overflow on mobile", async ({ page }) => {
  const brand = auditedBrand(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(/\/api\/connections(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ workspace: { name: "Solo Founder Workspace" }, connections: [] }),
    });
  });
  await page.route(/\/api\/billing(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        billing: {
          canManage: true,
          entitlements: { canUseOpus: false },
          resources: { connections: 0 },
        },
      }),
    });
  });
  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true, conversations: [] }),
    });
  });
  await page.route(/\/api\/brands(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true, brands: [brand] }),
    });
  });

  await page.goto("/app");
  await page.getByRole("button", { name: "Brand", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Marpin Distribution OS" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save brand" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Brand name" })).toBeVisible();

  const layout = await page.evaluate(() => {
    const field = document.querySelector<HTMLInputElement>("main input");
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      fieldWidth: field?.getBoundingClientRect().width ?? 0,
    };
  });
  expect(layout.overflow).toBe(0);
  expect(layout.fieldWidth).toBeGreaterThan(220);
});
