import assert from "node:assert/strict";
import test from "node:test";

import { GET as trackingRedirect } from "@/app/go/[slug]/route";
import { WorkspaceAuthorizationError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  InfluencerConflictError,
  InfluencerNotFoundError,
} from "@/lib/influencers/errors";
import {
  parseCreateInfluencerOutreachBody,
  parseCreateInfluencerTrackingBody,
  parsePatchInfluencerBody,
} from "@/lib/influencers/parsers";
import {
  createInfluencerOutreachDraft,
  createInfluencerProfile,
  createInfluencerTracking,
  disableInfluencerTracking,
  getInfluencerWorkspace,
  patchInfluencerProfile,
} from "@/lib/influencers/service";
import {
  parseInfluencerProfile,
} from "@/lib/influencers/validation";

function disposableDatabaseEnabled(): boolean {
  if (process.env.MARPIN_INTEGRATION_DATABASE !== "1") return false;
  const databaseUrl = process.env.DATABASE_URL;
  const allowedUrl = process.env.POSTGRES_TEST_URL ?? process.env.TEST_DATABASE_URL;
  if (!databaseUrl || !allowedUrl || databaseUrl !== allowedUrl) return false;
  try {
    const url = new URL(databaseUrl);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      /(?:_test|_ci)$/.test(url.pathname.slice(1))
    );
  } catch {
    return false;
  }
}

const integrationTest = disposableDatabaseEnabled() ? test : test.skip;
const APP_URL = "https://app.example";

function suffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function profile(overrides: Record<string, unknown> = {}) {
  return parseInfluencerProfile({
    platform: "instagram",
    handle: "@BuildWithAda",
    profileUrl: "https://www.instagram.com/buildwithada/",
    displayName: "Ada Builds",
    contactEmail: "PARTNERS@EXAMPLE.COM",
    contactName: "Ada",
    topics: ["developer tools", "saas"],
    audienceCountries: ["es", "us"],
    notes: "Strong product education fit.",
    status: "qualified",
    source: "manual",
    metrics: [],
    ...overrides,
  });
}

integrationTest("influencer CRM is tenant-safe, replay-safe, redacted, assisted, tracked, and cascading", async () => {
  const id = suffix();
  const workspace = await prisma.workspace.create({
    data: { name: "Influencer CRM", slug: `influencer-${id}` },
  });
  const otherWorkspace = await prisma.workspace.create({
    data: { name: "Other influencer CRM", slug: `influencer-other-${id}` },
  });

  try {
    const brand = await prisma.brand.create({
      data: {
        workspaceId: workspace.id,
        name: "Marpin",
        websiteUrl: "https://www.marpin.ai",
        isPrimary: true,
      },
    });
    const otherBrand = await prisma.brand.create({
      data: {
        workspaceId: otherWorkspace.id,
        name: "Other",
        websiteUrl: "https://other.example",
        isPrimary: true,
      },
    });
    const createInput = {
      workspaceId: workspace.id,
      brandId: brand.id,
      actorId: "owner-1",
      actorRole: "owner" as const,
      requestId: `profile-create-${id}`,
      profile: profile(),
      now: new Date("2026-08-20T10:00:00.000Z"),
      appUrl: APP_URL,
    };

    const [first, replay] = await Promise.all([
      createInfluencerProfile(createInput),
      createInfluencerProfile({
        ...createInput,
        profile: profile({ topics: ["saas", "developer tools"] }),
      }),
    ]);
    assert.equal(first.profile.id, replay.profile.id);
    assert.equal(first.profile.version, 1);
    assert.equal(replay.profile.version, 1);
    assert.deepEqual(new Set([first.replayed, replay.replayed]), new Set([false, true]));
    assert.equal(await prisma.influencerProfile.count({
      where: { workspaceId: workspace.id, requestId: createInput.requestId },
    }), 1);
    await assert.rejects(
      () => createInfluencerProfile({
        ...createInput,
        profile: profile({ notes: "Different semantic payload." }),
      }),
      (error: unknown) =>
        error instanceof InfluencerConflictError &&
        error.code === "request_conflict",
    );

    await assert.rejects(
      () => createInfluencerProfile({
        ...createInput,
        requestId: `profile-duplicate-${id}`,
      }),
      (error: unknown) =>
        error instanceof InfluencerConflictError &&
        error.code === "identity_conflict",
    );
    const youtube = await createInfluencerProfile({
      ...createInput,
      requestId: `profile-youtube-${id}`,
      profile: profile({
        platform: "youtube",
        profileUrl: "https://www.youtube.com/@buildwithada",
        metrics: [{
          metric: "audience_size",
          value: 0,
          sourceUrl: "https://www.youtube.com/@buildwithada",
          observedAt: "2026-08-19T00:00:00.000Z",
          source: "public_profile",
        }],
      }),
    });
    assert.notEqual(youtube.profile.id, first.profile.id);
    assert.equal(youtube.profile.metrics[0]?.value, 0);
    assert.deepEqual(first.profile.metrics, []);

    const otherTenantProfile = await createInfluencerProfile({
      ...createInput,
      workspaceId: otherWorkspace.id,
      brandId: otherBrand.id,
      requestId: `profile-other-${id}`,
      actorId: "other-owner",
    });
    assert.notEqual(otherTenantProfile.profile.id, first.profile.id);

    const ownerView = await getInfluencerWorkspace({
      workspaceId: workspace.id,
      brandId: brand.id,
      actorRole: "owner",
      appUrl: APP_URL,
    });
    const memberView = await getInfluencerWorkspace({
      workspaceId: workspace.id,
      brandId: brand.id,
      actorRole: "member",
      appUrl: APP_URL,
    });
    assert.equal(ownerView.coverage.profileCount, 2);
    assert.equal(ownerView.coverage.observedAt, "2026-08-19T00:00:00.000Z");
    assert.equal(ownerView.profiles.find((item) => item.id === first.profile.id)?.contactEmail, "partners@example.com");
    assert.equal(memberView.profiles.find((item) => item.id === first.profile.id)?.contactEmail, null);
    assert.equal(memberView.profiles.find((item) => item.id === first.profile.id)?.contactName, null);
    assert.deepEqual(ownerView.profiles[0].campaigns, []);
    assert.deepEqual(ownerView.profiles[0].deliverables, []);

    await assert.rejects(
      () => patchInfluencerProfile({
        workspaceId: workspace.id,
        profileId: first.profile.id,
        actorId: "member-1",
        actorRole: "member",
        patch: parsePatchInfluencerBody({ expectedVersion: 1, status: "active" }),
        appUrl: APP_URL,
      }),
      WorkspaceAuthorizationError,
    );
    await assert.rejects(
      () => patchInfluencerProfile({
        workspaceId: otherWorkspace.id,
        profileId: first.profile.id,
        actorId: "other-owner",
        actorRole: "owner",
        patch: parsePatchInfluencerBody({ expectedVersion: 1, status: "active" }),
        appUrl: APP_URL,
      }),
      InfluencerNotFoundError,
    );
    await assert.rejects(
      () => getInfluencerWorkspace({
        workspaceId: workspace.id,
        brandId: otherBrand.id,
        actorRole: "owner",
        appUrl: APP_URL,
      }),
      InfluencerNotFoundError,
    );

    const completePatch = await patchInfluencerProfile({
      workspaceId: workspace.id,
      profileId: first.profile.id,
      actorId: "owner-1",
      actorRole: "owner",
      patch: parsePatchInfluencerBody({
        expectedVersion: 1,
        ...profile({
          displayName: "Ada Builds Software",
          notes: "Updated manually from the edit dialog.",
        }),
      }),
      now: new Date("2026-08-20T11:00:00.000Z"),
      appUrl: APP_URL,
    });
    assert.equal(completePatch.profile.version, 2);
    assert.equal(completePatch.profile.displayName, "Ada Builds Software");
    const patched = await patchInfluencerProfile({
      workspaceId: workspace.id,
      profileId: first.profile.id,
      actorId: "owner-1",
      actorRole: "owner",
      patch: parsePatchInfluencerBody({ expectedVersion: 2, status: "outreach_ready" }),
      now: new Date("2026-08-20T11:30:00.000Z"),
      appUrl: APP_URL,
    });
    assert.equal(patched.profile.version, 3);
    assert.equal(patched.profile.status, "outreach_ready");
    await assert.rejects(
      () => patchInfluencerProfile({
        workspaceId: workspace.id,
        profileId: first.profile.id,
        actorId: "owner-1",
        actorRole: "owner",
        patch: parsePatchInfluencerBody({ expectedVersion: 2, status: "active" }),
        appUrl: APP_URL,
      }),
      (error: unknown) =>
        error instanceof InfluencerConflictError &&
        error.code === "version_conflict" &&
        error.currentVersion === 3,
    );

    const outreachBody = parseCreateInfluencerOutreachBody({
      expectedVersion: 3,
      requestId: `outreach-save-${id}`,
      draft: {
        subject: "A practical Marpin collaboration",
        body: "Would you be interested in testing Marpin with your audience?",
        sponsorshipDisclosure: "Clearly label any paid placement as sponsored.",
        claimsRestrictions: "Do not promise guaranteed growth.",
        compensationNote: null,
      },
    });
    const [outreach, outreachReplay] = await Promise.all([
      createInfluencerOutreachDraft({
        workspaceId: workspace.id,
        profileId: first.profile.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: outreachBody,
        now: new Date("2026-08-20T12:00:00.000Z"),
        appUrl: APP_URL,
      }),
      createInfluencerOutreachDraft({
        workspaceId: workspace.id,
        profileId: first.profile.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: outreachBody,
        now: new Date("2026-08-20T12:00:00.000Z"),
        appUrl: APP_URL,
      }),
    ]);
    assert.equal(outreach.outreachDraftId, outreachReplay.outreachDraftId);
    assert.equal(outreach.profile.version, 4);
    assert.equal(outreachReplay.profile.version, 4);
    assert.deepEqual(
      new Set([outreach.replayed, outreachReplay.replayed]),
      new Set([false, true]),
    );
    assert.equal(outreach.profile.status, "outreach_ready");
    assert.equal(outreach.profile.outreachDrafts[0]?.status, "draft");
    assert.equal(await prisma.influencerOutreachDraft.count({
      where: { profileId: first.profile.id },
    }), 1);
    await assert.rejects(
      () => createInfluencerOutreachDraft({
        workspaceId: workspace.id,
        profileId: first.profile.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: parseCreateInfluencerOutreachBody({
          ...outreachBody,
          requestId: outreachBody.requestId,
          draft: {
            ...outreachBody.draft,
            body: "Different outreach.",
          },
        }),
        appUrl: APP_URL,
      }),
      (error: unknown) =>
        error instanceof InfluencerConflictError &&
        error.code === "request_conflict",
    );

    const trackingBody = parseCreateInfluencerTrackingBody({
      requestId: `tracking-create-${id}`,
      destinationUrl: "https://www.marpin.ai/offer?source=crm#ignored",
      campaignKey: "creator_launch",
    });
    const [tracking, trackingReplay] = await Promise.all([
      createInfluencerTracking({
        workspaceId: workspace.id,
        profileId: first.profile.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: trackingBody,
        now: new Date("2026-08-20T13:00:00.000Z"),
        appUrl: APP_URL,
        generateSlug: () => "abcdefghijklmnopqrstuvwxyzABCDEFGH",
      }),
      createInfluencerTracking({
        workspaceId: workspace.id,
        profileId: first.profile.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: trackingBody,
        now: new Date("2026-08-20T13:00:00.000Z"),
        appUrl: APP_URL,
        generateSlug: () => "abcdefghijklmnopqrstuvwxyzABCDEFGH",
      }),
    ]);
    assert.equal(tracking.profile.version, 5);
    assert.equal(trackingReplay.profile.version, 5);
    assert.equal(tracking.trackingLink.id, trackingReplay.trackingLink.id);
    assert.deepEqual(
      new Set([tracking.replayed, trackingReplay.replayed]),
      new Set([false, true]),
    );
    assert.equal(
      tracking.trackingLink.trackingUrl,
      `${APP_URL}/go/abcdefghijklmnopqrstuvwxyzABCDEFGH`,
    );
    const tagged = new URL(tracking.trackingLink.taggedDestinationUrl);
    assert.equal(tagged.hash, "");
    assert.equal(tagged.searchParams.get("utm_source"), "instagram");
    assert.equal(tagged.searchParams.get("utm_medium"), "influencer");
    assert.equal(tagged.searchParams.get("utm_campaign"), "creator_launch");
    assert.equal(await prisma.influencerTrackingLink.count({
      where: { profileId: first.profile.id },
    }), 1);
    await assert.rejects(
      () => createInfluencerTracking({
        workspaceId: workspace.id,
        profileId: first.profile.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: parseCreateInfluencerTrackingBody({
          ...trackingBody,
          destinationUrl: "https://www.marpin.ai/different",
        }),
        appUrl: APP_URL,
      }),
      (error: unknown) =>
        error instanceof InfluencerConflictError &&
        error.code === "request_conflict",
    );

    const beforeClick = new Date();
    const redirect = await trackingRedirect(
      new Request(`${APP_URL}/go/${tracking.trackingLink.slug}`, {
        headers: {
          "User-Agent": "must-not-be-stored",
          "X-Forwarded-For": "203.0.113.7",
        },
      }),
      { params: Promise.resolve({ slug: tracking.trackingLink.slug }) },
    );
    assert.equal(redirect.status, 307);
    assert.equal(redirect.headers.get("location"), tracking.trackingLink.taggedDestinationUrl);
    assert.match(redirect.headers.get("cache-control") ?? "", /no-store/);
    const clicked = await prisma.influencerTrackingLink.findUniqueOrThrow({
      where: { id: tracking.trackingLink.id },
    });
    assert.equal(clicked.clickCount, 1n);
    assert.ok(clicked.lastClickedAt);
    assert.ok(clicked.lastClickedAt.getTime() >= beforeClick.getTime());

    const disabledProfile = await disableInfluencerTracking({
      workspaceId: workspace.id,
      profileId: first.profile.id,
      trackingLinkId: tracking.trackingLink.id,
      actorId: "owner-1",
      actorRole: "owner",
      expectedVersion: tracking.trackingLink.version,
      now: new Date("2026-08-20T15:00:00.000Z"),
      appUrl: APP_URL,
    });
    assert.equal(disabledProfile.profile.trackingLinks[0]?.enabled, false);
    assert.equal(disabledProfile.profile.trackingLinks[0]?.version, 2);
    await assert.rejects(
      () => disableInfluencerTracking({
        workspaceId: workspace.id,
        profileId: first.profile.id,
        trackingLinkId: tracking.trackingLink.id,
        actorId: "owner-1",
        actorRole: "owner",
        expectedVersion: tracking.trackingLink.version,
        appUrl: APP_URL,
      }),
      (error: unknown) =>
        error instanceof InfluencerConflictError &&
        error.code === "version_conflict" &&
        error.currentVersion === 2,
    );
    const disabled = await trackingRedirect(
      new Request(`${APP_URL}/go/${tracking.trackingLink.slug}`),
      { params: Promise.resolve({ slug: tracking.trackingLink.slug }) },
    );
    assert.equal(disabled.status, 404);
    assert.equal(disabled.headers.get("location"), null);
    assert.equal(
      (await prisma.influencerTrackingLink.findUniqueOrThrow({
        where: { id: tracking.trackingLink.id },
      })).clickCount,
      1n,
    );

    await prisma.influencerTrackingLink.update({
      where: { id: tracking.trackingLink.id },
      data: {
        enabled: true,
        disabledAt: null,
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    });
    const expired = await trackingRedirect(
      new Request(`${APP_URL}/go/${tracking.trackingLink.slug}`),
      { params: Promise.resolve({ slug: tracking.trackingLink.slug }) },
    );
    assert.equal(expired.status, 404);
    assert.equal(
      (await prisma.influencerTrackingLink.findUniqueOrThrow({
        where: { id: tracking.trackingLink.id },
      })).clickCount,
      1n,
    );

    await prisma.brand.delete({ where: { id: brand.id } });
    assert.equal(await prisma.influencerProfile.count({
      where: { workspaceId: workspace.id },
    }), 0);
    assert.equal(await prisma.influencerMetricEvidence.count({
      where: { workspaceId: workspace.id },
    }), 0);
    assert.equal(await prisma.influencerOutreachDraft.count({
      where: { workspaceId: workspace.id },
    }), 0);
    assert.equal(await prisma.influencerTrackingLink.count({
      where: { workspaceId: workspace.id },
    }), 0);

    await prisma.workspace.delete({ where: { id: otherWorkspace.id } });
    assert.equal(await prisma.influencerProfile.count({
      where: { workspaceId: otherWorkspace.id },
    }), 0);
  } finally {
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspace.id, otherWorkspace.id] } },
    });
  }
});
