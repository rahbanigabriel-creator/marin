import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PREVIEW = {
  sourceUrl: "https://example.com/",
  finalUrl: "https://www.example.com/",
  title: "Example developer platform",
  score: 72,
  summary: {
    wordCount: 834,
    h1Count: 1,
    links: 27,
    imagesWithoutAlt: 2,
    indexAllowed: true,
  },
  findings: [
    {
      code: "meta-description-missing",
      severity: "warning",
      title: "The page has no meta description",
      evidence: "No description metadata was found.",
      recommendation: "Add a concise description that explains the product and audience.",
    },
    {
      code: "images-missing-alt",
      severity: "warning",
      title: "Two images are missing alt text",
      evidence: "2 of 4 images have no alt attribute.",
      recommendation: "Add useful alt text to meaningful images.",
    },
  ],
};

async function mockAudit(page: Page) {
  await page.route(/\/api\/public\/audit$/, async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ url: "example.com" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ audit: PREVIEW }),
    });
  });
}

test("a signed-out founder gets a real URL-first audit preview", async ({ page }) => {
  await mockAudit(page);
  await page.goto("/");

  const website = page.getByRole("textbox", { name: "Your website URL" }).first();
  await website.fill("example.com");
  await page.getByRole("button", { name: "Analyze free" }).first().click();

  await expect(page.getByRole("heading", { name: "Example developer platform" })).toBeVisible();
  await expect(page.getByLabel("Website score 72 out of 100")).toBeVisible();
  await expect(page.getByText("834")).toBeVisible();
  await expect(page.getByText("The page has no meta description")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save the full audit and build my plan" })).toBeEnabled();

  const accessibility = await new AxeBuilder({ page })
    .include("main")
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test("the signup handoff stays in an HttpOnly cookie while only the final URL is redirected", async ({ page }) => {
  const opaqueToken = "A".repeat(43);
  await page.route(/\/api\/public\/audit$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Set-Cookie": `marpin_audit_handoff=${opaqueToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900`,
      },
      body: JSON.stringify({ audit: PREVIEW }),
    });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Your website URL" }).first().fill("example.com");
  await page.getByRole("button", { name: "Analyze free" }).first().click();
  await expect(page.getByRole("heading", { name: "Example developer platform" })).toBeVisible();

  const handoffCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "marpin_audit_handoff",
  );
  expect(handoffCookie).toMatchObject({
    value: opaqueToken,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
  });

  await page
    .getByRole("button", { name: "Save the full audit and build my plan" })
    .click({ noWaitAfter: true });
  await page.waitForURL(/\/sign-up\?/);
  const signupUrl = new URL(page.url());
  const destination = signupUrl.searchParams.get("redirect_url");

  expect(signupUrl.searchParams.size).toBe(1);
  expect(destination).toBe("/app?q=https%3A%2F%2Fwww.example.com%2F");
  expect(signupUrl.href).not.toContain(opaqueToken);
  expect(destination).not.toContain(opaqueToken);
});

test("the audit preview remains contained on a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mockAudit(page);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Your website URL" }).first().fill("example.com");
  await page.getByRole("button", { name: "Analyze free" }).first().click();
  await expect(page.getByRole("heading", { name: "Example developer platform" })).toBeVisible();

  const sizes = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(sizes.body).toBeLessThanOrEqual(sizes.viewport);
});
