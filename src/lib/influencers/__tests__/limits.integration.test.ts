import assert from "node:assert/strict";
import test from "node:test";

import { influencerApiFailure } from "@/app/api/influencers/_lib/http";
import { prisma } from "@/lib/db";
import { InfluencerLimitExceededError } from "@/lib/influencers/errors";
import {
  parseCreateInfluencerOutreachBody,
  parseCreateInfluencerTrackingBody,
} from "@/lib/influencers/parsers";
import {
  createInfluencerOutreachDraft,
  createInfluencerProfile,
  createInfluencerTracking,
} from "@/lib/influencers/service";
import { parseInfluencerProfile } from "@/lib/influencers/validation";
import { enforceInfluencerMutationRateLimit } from "@/lib/security/rate-limit";

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

function profile(handle: string) {
  return parseInfluencerProfile({
    platform: "instagram",
    handle,
    profileUrl: `https://www.instagram.com/${handle}/`,
    displayName: handle,
    topics: ["developer tools"],
    audienceCountries: ["es"],
    status: "qualified",
    source: "manual",
    metrics: [],
  });
}

async function workspaceWithBrand(label: string) {
  const id = suffix();
  const workspace = await prisma.workspace.create({
    data: { name: label, slug: `${label.toLowerCase().replace(/[^a-z]+/g, "-")}-${id}` },
  });
  const brand = await prisma.brand.create({
    data: {
      workspaceId: workspace.id,
      name: "Marpin",
      websiteUrl: "https://www.marpin.ai",
      isPrimary: true,
    },
  });
  return { workspace, brand, id };
}

function profileSeed(input: {
  workspaceId: string;
  brandId: string;
  handle: string;
  requestId: string;
}) {
  return {
    workspaceId: input.workspaceId,
    brandId: input.brandId,
    platform: "instagram",
    handle: input.handle,
    normalizedHandle: input.handle,
    profileUrl: `https://www.instagram.com/${input.handle}/`,
    displayName: input.handle,
    topics: [],
    audienceCountries: [],
    status: "prospect",
    source: "manual",
    requestId: input.requestId,
    requestHash: `hash-${input.requestId}`,
    createdBy: "owner-1",
    updatedBy: "owner-1",
  };
}

function assertLimit(error: unknown, resource: string, limit: number): boolean {
  assert.equal(error instanceof InfluencerLimitExceededError, true);
  const quota = error as InfluencerLimitExceededError;
  assert.equal(quota.resource, resource);
  assert.equal(quota.limit, limit);
  assert.equal(quota.planId, "free");
  return true;
}

integrationTest("profile caps are race-safe and preserve idempotent replays", async () => {
  const { workspace, brand, id } = await workspaceWithBrand("Influencer profile cap");
  try {
    await prisma.influencerProfile.createMany({
      data: Array.from({ length: 24 }, (_, index) => profileSeed({
        workspaceId: workspace.id,
        brandId: brand.id,
        handle: `seed-profile-${index}-${id}`,
        requestId: `seed-profile-${index}-${id}`,
      })),
    });
    const inputs = ["boundary-a", "boundary-b"].map((handle) => ({
      workspaceId: workspace.id,
      brandId: brand.id,
      actorId: "owner-1",
      actorRole: "owner" as const,
      requestId: `${handle}-${id}`,
      profile: profile(`${handle}-${id}`),
      appUrl: APP_URL,
    }));

    const results = await Promise.allSettled(inputs.map(createInfluencerProfile));
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof createInfluencerProfile>>> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assertLimit(rejected[0]?.reason, "profiles", 25);
    assert.equal(
      await prisma.influencerProfile.count({ where: { workspaceId: workspace.id } }),
      25,
    );

    const winningInput = inputs.find(
      (input) => input.profile.handle === fulfilled[0]?.value.profile.handle,
    );
    assert.ok(winningInput);
    const replay = await createInfluencerProfile(winningInput);
    assert.equal(replay.replayed, true);

    const response = influencerApiFailure(rejected[0]?.reason, "profile_create");
    assert.equal(response.status, 402);
    assert.deepEqual(await response.json(), {
      error: "payment_required",
      code: "influencer_limit_exceeded",
      message: "The free plan limit of 25 influencer profiles has been reached",
      resource: "profiles",
      limit: 25,
      plan: "free",
    });
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } });
  }
});

integrationTest("outreach and tracking caps are durable while replays remain safe", async () => {
  const { workspace, brand, id } = await workspaceWithBrand("Influencer artifact cap");
  try {
    const created = await createInfluencerProfile({
      workspaceId: workspace.id,
      brandId: brand.id,
      actorId: "owner-1",
      actorRole: "owner",
      requestId: `profile-${id}`,
      profile: profile(`artifact-owner-${id}`),
      appUrl: APP_URL,
    });
    const outreachBody = parseCreateInfluencerOutreachBody({
      expectedVersion: created.profile.version,
      requestId: `outreach-first-${id}`,
      draft: {
        subject: "A practical collaboration",
        body: "Would you like to test Marpin with your audience?",
        sponsorshipDisclosure: "Label paid placements clearly as sponsored.",
        claimsRestrictions: "Do not promise guaranteed results.",
      },
    });
    const firstOutreach = await createInfluencerOutreachDraft({
      workspaceId: workspace.id,
      profileId: created.profile.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: outreachBody,
      appUrl: APP_URL,
    });
    await prisma.influencerOutreachDraft.createMany({
      data: Array.from({ length: 49 }, (_, index) => ({
        workspaceId: workspace.id,
        brandId: brand.id,
        profileId: created.profile.id,
        profileVersion: firstOutreach.profile.version,
        requestId: `outreach-seed-${index}-${id}`,
        requestHash: `outreach-hash-${index}-${id}`,
        body: "Persisted assisted outreach draft.",
        sponsorshipDisclosure: "Sponsored partnership.",
        status: "draft",
        createdBy: "owner-1",
        updatedBy: "owner-1",
      })),
    });
    assert.equal((await createInfluencerOutreachDraft({
      workspaceId: workspace.id,
      profileId: created.profile.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: outreachBody,
      appUrl: APP_URL,
    })).replayed, true);
    await assert.rejects(
      () => createInfluencerOutreachDraft({
        workspaceId: workspace.id,
        profileId: created.profile.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: parseCreateInfluencerOutreachBody({
          ...outreachBody,
          expectedVersion: firstOutreach.profile.version,
          requestId: `outreach-over-${id}`,
        }),
        appUrl: APP_URL,
      }),
      (error: unknown) => assertLimit(error, "outreach_drafts", 50),
    );

    const trackingBody = parseCreateInfluencerTrackingBody({
      requestId: `tracking-first-${id}`,
      destinationUrl: "https://www.marpin.ai/founders",
      campaignKey: "founder_launch",
    });
    const firstTracking = await createInfluencerTracking({
      workspaceId: workspace.id,
      profileId: created.profile.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: trackingBody,
      appUrl: APP_URL,
      generateSlug: () => "abcdefghijklmnopqrstuvwxyzABCDEFGH",
    });
    await prisma.influencerTrackingLink.createMany({
      data: Array.from({ length: 24 }, (_, index) => ({
        workspaceId: workspace.id,
        brandId: brand.id,
        profileId: created.profile.id,
        requestId: `tracking-seed-${index}-${id}`,
        requestHash: `tracking-hash-${index}-${id}`,
        slug: `tracking_${String(index).padStart(2, "0")}_${id}`,
        destinationUrl: "https://www.marpin.ai/founders",
        taggedDestinationUrl: "https://www.marpin.ai/founders?utm_medium=influencer",
        campaignKey: "founder_launch",
        createdBy: "owner-1",
      })),
    });
    assert.equal((await createInfluencerTracking({
      workspaceId: workspace.id,
      profileId: created.profile.id,
      actorId: "owner-1",
      actorRole: "owner",
      body: trackingBody,
      appUrl: APP_URL,
    })).replayed, true);
    await assert.rejects(
      () => createInfluencerTracking({
        workspaceId: workspace.id,
        profileId: created.profile.id,
        actorId: "owner-1",
        actorRole: "owner",
        body: parseCreateInfluencerTrackingBody({
          ...trackingBody,
          requestId: `tracking-over-${id}`,
        }),
        appUrl: APP_URL,
      }),
      (error: unknown) => assertLimit(error, "tracking_links", 25),
    );
    assert.equal(firstTracking.replayed, false);
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } });
  }
});

integrationTest("authenticated influencer throttling returns a privacy-safe 429", async () => {
  const keys: string[] = [];
  const response = await enforceInfluencerMutationRateLimit(
    { userId: "user-private", workspaceId: "workspace-private" },
    {
      isDeployment: true,
      redisConfigured: true,
      pepper: "test-only-pepper-with-32-characters",
      limit: async (key) => {
        keys.push(key);
        return {
          success: keys.length === 1,
          limit: 30,
          remaining: keys.length === 1 ? 29 : 0,
          reset: Date.now() + 30_000,
        };
      },
    },
  );
  assert.ok(response);
  assert.equal(response.status, 429);
  assert.match(response.headers.get("retry-after") ?? "", /^\d+$/);
  assert.deepEqual(await response.json(), {
    error: "rate_limited",
    code: "rate_limit_exceeded",
  });
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.equal(keys.join("").includes("user-private"), false);
  assert.equal(keys.join("").includes("workspace-private"), false);
});
