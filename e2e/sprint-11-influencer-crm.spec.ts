import { expect, test, type Page, type Route } from "@playwright/test";

import type {
  InfluencerProfileDto,
  InfluencerWorkspaceResponse,
} from "../src/components/influencers/types";

test.setTimeout(180_000);

const NOW = "2026-08-20T10:30:00.000Z";
const BRAND = {
  id: "brand_sprint11",
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
  timezone: "Europe/Madrid",
  currency: "EUR",
  contextVersion: 1,
  auditSnapshot: null,
  auditedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockShell(page: Page, canManage: boolean): Promise<void> {
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
    json(route, { calendar: { timezone: "Europe/Madrid", plans: [], contentItems: [], publications: [] } }),
  );
}

function initialProfiles(): InfluencerProfileDto[] {
  return [
    {
      id: "profile_instagram_devfounder",
      version: 3,
      platform: "instagram",
      handle: "DevFounder",
      normalizedHandle: "devfounder",
      profileUrl: "https://www.instagram.com/devfounder",
      displayName: "Ava Builds",
      contactEmail: "ava@example.com",
      contactName: "Ava Ruiz",
      topics: ["saas", "bootstrapping"],
      audienceCountries: ["spain", "united kingdom"],
      notes: "Strong founder audience. Verify recent product sponsorship fit.",
      status: "researching",
      source: "manual",
      metrics: [
        {
          metric: "audience_size",
          value: 12_400,
          sourceUrl: "https://www.instagram.com/devfounder",
          observedAt: "2026-08-18T00:00:00.000Z",
          source: "public_profile",
        },
        {
          metric: "engagement_rate",
          value: 4.25,
          sourceUrl: null,
          observedAt: "2026-08-18T00:00:00.000Z",
          source: "manual",
        },
      ],
      qualificationEvidence: [
        {
          id: "evidence_ava",
          label: "Audience fit",
          detail: "Recent posts focus on founder distribution",
          sourceUrl: "https://www.instagram.com/devfounder",
          observedAt: "2026-08-18T00:00:00.000Z",
        },
      ],
      outreachDrafts: [],
      trackingLinks: [],
      campaigns: [],
      deliverables: [],
      lastActivityAt: "2026-08-20T09:00:00.000Z",
      createdAt: "2026-08-17T09:00:00.000Z",
      updatedAt: "2026-08-20T09:00:00.000Z",
    },
    {
      id: "profile_youtube_devfounder",
      version: 1,
      platform: "youtube",
      handle: "devfounder",
      normalizedHandle: "devfounder",
      profileUrl: "https://www.youtube.com/@devfounder",
      displayName: "Dev Founder Weekly",
      contactEmail: "studio@example.com",
      contactName: "Studio Team",
      topics: ["software"],
      audienceCountries: [],
      notes: null,
      status: "prospect",
      source: "import",
      metrics: [],
      qualificationEvidence: [],
      outreachDrafts: [],
      trackingLinks: [],
      campaigns: [],
      deliverables: [],
      lastActivityAt: null,
      createdAt: "2026-08-19T09:00:00.000Z",
      updatedAt: "2026-08-19T09:00:00.000Z",
    },
  ];
}

function workspace(
  profiles: InfluencerProfileDto[],
  canManage: boolean,
): InfluencerWorkspaceResponse {
  return {
    profiles,
    capability: {
      canManage,
      contactVisibility: canManage ? "full" : "redacted",
      vendorDiscovery: "unavailable",
      aiAssistance: canManage ? "available" : "upgrade_required",
      outreachExecution: "assisted",
    },
    coverage: {
      profileCount: profiles.length,
      observedAt: "2026-08-20T09:00:00.000Z",
      lastActivityAt: NOW,
      detail: "Persisted workspace profiles",
    },
  };
}

async function installInfluencerApi(page: Page, canManage: boolean): Promise<{
  profiles: () => InfluencerProfileDto[];
}> {
  let profiles = initialProfiles();
  let editConflictPending = true;

  await page.route(/\/api\/influencers(?:\/.*)?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split("/").filter(Boolean);

    if (url.pathname === "/api/influencers" && request.method() === "GET") {
      expect(url.searchParams.get("brandId")).toBe(BRAND.id);
      await json(route, workspace(profiles, canManage));
      return;
    }

    if (!canManage) {
      await json(route, { error: "forbidden" }, 403);
      return;
    }

    if (url.pathname === "/api/influencers" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      expect(body.brandId).toBe(BRAND.id);
      expect(typeof body.requestId).toBe("string");
      expect(String(body.requestId).length).toBeGreaterThan(20);
      const input = body.profile as Record<string, unknown>;
      expect(input.platform).toBe("pinterest");
      expect(input.handle).toBe("growthmaker");
      expect(input.metrics).toEqual([
        {
          metric: "audience_size",
          value: 8750,
          source: "public_profile",
          sourceUrl: "https://www.pinterest.com/growthmaker",
          observedAt: "2026-08-20T00:00:00.000Z",
        },
      ]);
      const created: InfluencerProfileDto = {
        id: "profile_pinterest_growthmaker",
        version: 1,
        platform: "pinterest",
        handle: "growthmaker",
        normalizedHandle: "growthmaker",
        profileUrl: String(input.profileUrl),
        displayName: String(input.displayName),
        contactEmail: String(input.contactEmail),
        contactName: String(input.contactName),
        topics: input.topics as string[],
        audienceCountries: input.audienceCountries as string[],
        notes: String(input.notes),
        status: input.status as InfluencerProfileDto["status"],
        source: input.source as InfluencerProfileDto["source"],
        metrics: input.metrics as InfluencerProfileDto["metrics"],
        qualificationEvidence: [],
        outreachDrafts: [],
        trackingLinks: [],
        campaigns: [],
        deliverables: [],
        lastActivityAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      };
      profiles = [created, ...profiles];
      await json(route, { profile: created }, 201);
      return;
    }

    const profileId = parts[2];
    const current = profiles.find((profile) => profile.id === profileId);
    if (!current) {
      await json(route, { error: "not_found" }, 404);
      return;
    }

    if (parts.length === 3 && request.method() === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown>;
      expect(body.expectedVersion).toBe(current.version);
      if (body.displayName === "Growth Maker Studio" && editConflictPending) {
        editConflictPending = false;
        await json(route, { error: "version_conflict", message: "This profile changed elsewhere. Reload the latest version before continuing." }, 409);
        return;
      }
      const { expectedVersion: _expectedVersion, ...fields } = body;
      void _expectedVersion;
      const updated: InfluencerProfileDto = {
        ...current,
        ...fields,
        version: current.version + 1,
        updatedAt: NOW,
        lastActivityAt: NOW,
      } as InfluencerProfileDto;
      profiles = profiles.map((profile) => profile.id === current.id ? updated : profile);
      await json(route, { profile: updated });
      return;
    }

    if (parts[3] === "outreach" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      expect(body.expectedVersion).toBe(current.version);
      expect(typeof body.requestId).toBe("string");
      const draft = body.draft as Record<string, unknown>;
      expect(draft.sponsorshipDisclosure).toBe("Sponsored collaboration with clear paid partnership disclosure.");
      const updated: InfluencerProfileDto = {
        ...current,
        version: current.version + 1,
        outreachDrafts: [{
          id: "outreach_growthmaker",
          subject: draft.subject as string | null,
          body: String(draft.body),
          sponsorshipDisclosure: String(draft.sponsorshipDisclosure),
          claimsRestrictions: draft.claimsRestrictions as string | null,
          compensationNote: draft.compensationNote as string | null,
          status: "draft",
          createdAt: NOW,
          updatedAt: NOW,
        }],
        lastActivityAt: NOW,
        updatedAt: NOW,
      };
      profiles = profiles.map((profile) => profile.id === current.id ? updated : profile);
      await json(route, { profile: updated, outreach: updated.outreachDrafts?.[0] }, 201);
      return;
    }

    if (parts[3] === "tracking-links" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      expect(typeof body.requestId).toBe("string");
      expect(body.destinationUrl).toBe("https://www.marpin.ai/pricing");
      expect(body.campaignKey).toBe("founder-week");
      const trackingLink = {
        id: "tracking_growthmaker",
        slug: "abcdefghijklmnopqrstuvwxyz123456",
        destinationUrl: "https://www.marpin.ai/pricing",
        taggedDestinationUrl: "https://www.marpin.ai/pricing?utm_source=pinterest&utm_medium=influencer&utm_campaign=founder-week&utm_content=growthmaker",
        trackingUrl: "https://www.marpin.ai/go/abcdefghijklmnopqrstuvwxyz123456",
        campaignKey: "founder-week",
        enabled: true,
        clickCount: "0",
        lastClickedAt: null,
        disabledAt: null,
        expiresAt: "2027-02-16T09:00:00.000Z",
        version: 1,
        createdAt: NOW,
      };
      const updated: InfluencerProfileDto = {
        ...current,
        trackingLinks: [trackingLink],
        lastActivityAt: NOW,
        updatedAt: NOW,
      };
      profiles = profiles.map((profile) => profile.id === current.id ? updated : profile);
      await json(route, { profile: updated, trackingLink }, 201);
      return;
    }

    if (parts[3] === "tracking-links" && parts[4] && request.method() === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown>;
      const existing = current.trackingLinks?.find((link) => link.id === parts[4]);
      expect(existing).toBeDefined();
      expect(body).toEqual({ expectedVersion: existing?.version });
      const links = (current.trackingLinks ?? []).map((link) => link.id === parts[4]
        ? { ...link, enabled: false, disabledAt: NOW, version: link.version + 1 }
        : link);
      const updated: InfluencerProfileDto = {
        ...current,
        version: current.version + 1,
        trackingLinks: links,
        lastActivityAt: NOW,
        updatedAt: NOW,
      };
      profiles = profiles.map((profile) => profile.id === current.id ? updated : profile);
      await json(route, { profile: updated });
      return;
    }

    await json(route, { error: "not_found" }, 404);
  });

  return { profiles: () => profiles };
}

test("an owner manages a sourced influencer pipeline without autonomous outreach or invented metrics", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockShell(page, true);
  const api = await installInfluencerApi(page, true);

  await page.goto("/app?mode=organic&view=influencers");
  const workspaceRoot = page.getByTestId("influencer-workspace");
  await expect(workspaceRoot).toBeVisible();
  await expect(page.getByText("Vendor discovery is unavailable. Add profiles manually or use an approved list import.")).toBeVisible();
  await expect(page.getByText("instagram:@devfounder").first()).toBeVisible();
  await expect(page.getByText("youtube:@devfounder").first()).toBeVisible();
  await expect(page.getByRole("table", { name: "Influencer pipeline" })).toContainText("Not available");

  const addProfile = page.getByRole("button", { name: "Add profile" }).first();
  await addProfile.click();
  const dialog = page.getByRole("dialog", { name: "Add profile" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Platform")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(addProfile).toBeFocused();

  await addProfile.click();
  const createDialog = page.getByRole("dialog", { name: "Add profile" });
  await createDialog.getByLabel("Platform").selectOption("pinterest");
  await createDialog.getByLabel("Handle").fill("@GrowthMaker");
  await createDialog.getByLabel("Profile URL").fill("https://www.pinterest.com/growthmaker");
  await createDialog.getByLabel("Display name").fill("Growth Maker");
  await createDialog.getByLabel("Contact name").fill("Maya Chen");
  await createDialog.getByLabel("Contact email").fill("maya@example.com");
  await createDialog.getByLabel("Topics").fill("growth, founder marketing");
  await createDialog.getByLabel("Audience countries").fill("Spain, France");
  await createDialog.getByLabel("Qualification notes").fill("Strong distribution education content with recent founder case studies.");
  await createDialog.getByLabel("Audience value").fill("8750");
  await createDialog.getByLabel("Audience evidence type").selectOption("public_profile");
  await createDialog.getByLabel("Audience observed date").fill("2026-08-20");
  await createDialog.getByLabel("Audience evidence URL").fill("https://www.pinterest.com/growthmaker");
  await createDialog.getByRole("button", { name: "Add profile" }).click();

  await expect(page.getByRole("heading", { name: "Growth Maker" })).toBeVisible();
  expect(api.profiles().some((profile) => profile.id === "profile_pinterest_growthmaker")).toBe(true);

  const stage = page.getByRole("combobox", { name: "Pipeline stage" });
  await stage.selectOption("qualified");
  await expect(stage).toHaveValue("qualified");

  await page.getByRole("button", { name: "Edit" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit profile" });
  await editDialog.getByLabel("Display name").fill("Growth Maker Studio");
  await editDialog.getByRole("button", { name: "Save profile" }).click();
  await expect(editDialog.getByRole("alert")).toContainText("changed elsewhere");
  await editDialog.getByRole("button", { name: "Reload latest" }).click();
  await expect(editDialog.getByLabel("Display name")).toHaveValue("Growth Maker");
  await editDialog.getByLabel("Display name").fill("Growth Maker Studio");
  await editDialog.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("heading", { name: "Growth Maker Studio" })).toBeVisible();

  await page.getByLabel("Subject").fill("Founder distribution collaboration");
  await page.getByLabel("Draft body").fill("Hi Maya, I would like to explore a practical Marpin walkthrough for your founder audience.");
  await page.getByLabel("Sponsorship disclosure").fill("Sponsored collaboration with clear paid partnership disclosure.");
  await page.getByLabel("Claims restrictions").fill("Do not promise guaranteed growth outcomes.");
  await page.getByLabel("Compensation note").fill("Fee and usage rights to be agreed before production.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByLabel("Draft body")).toHaveValue(/practical Marpin walkthrough/);
  await page.getByRole("button", { name: "Copy draft" }).click();
  await expect(page.getByText("Draft copied.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open email" })).toHaveAttribute("href", /^mailto:maya@example\.com\?/);
  await expect(page.getByRole("button", { name: /Send|Contact automatically/i })).toHaveCount(0);

  await page.getByLabel("Destination URL").fill("https://www.marpin.ai/pricing");
  await page.getByLabel("Campaign key").fill("founder-week");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("link", { name: /\/go\/abcdefghijklmnopqrstuvwxyz123456/ })).toBeVisible();
  await expect(page.getByText("0 clicks", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Disable tracking link" }).click();
  await expect(page.getByText("Disabled", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: /\/go\/abcdefghijklmnopqrstuvwxyz123456/ })).toHaveCount(0);

  await page.getByLabel("Search influencer profiles").fill("youtube:@devfounder");
  await expect(page.getByRole("table", { name: "Influencer pipeline" })).toContainText("Dev Founder Weekly");
  await expect(page.getByRole("table", { name: "Influencer pipeline" })).not.toContainText("Growth Maker Studio");
});

test("a member sees a redacted read-only CRM that remains contained at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShell(page, false);
  await installInfluencerApi(page, false);

  await page.goto("/app?mode=organic&view=influencers");
  const workspaceRoot = page.getByTestId("influencer-workspace");
  await expect(workspaceRoot).toBeVisible();
  await expect(workspaceRoot.locator('[data-influencer-id="profile_instagram_devfounder"]:visible')).toContainText("instagram:@devfounder");
  await expect(workspaceRoot.locator('[data-influencer-id="profile_youtube_devfounder"]:visible')).toContainText("Not available");
  await expect(page.getByRole("button", { name: "Add profile" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Pipeline stage" })).toHaveCount(0);
  await expect(page.getByTestId("influencer-contact-fields")).toHaveCount(0);
  await expect(page.getByText("ava@example.com")).toHaveCount(0);
  await expect(page.getByText("Ava Ruiz")).toHaveCount(0);
  await expect(page.getByText("Outreach preparation is read only for your workspace role.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);

  const containment = await workspaceRoot.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    right: element.getBoundingClientRect().right,
    viewport: window.innerWidth,
  }));
  expect(containment.scrollWidth).toBeLessThanOrEqual(containment.clientWidth + 1);
  expect(containment.right).toBeLessThanOrEqual(containment.viewport + 1);
});
