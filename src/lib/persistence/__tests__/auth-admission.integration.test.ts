import assert from "node:assert/strict";
import test from "node:test";

import {
  findOrCreateWorkspace,
  isWorkspaceSeatLimitError,
  WorkspaceAdminRequiredError,
  WorkspaceSeatLimitError,
} from "../../auth";
import { prisma } from "../../db";

function disposableDatabaseEnabled(): boolean {
  if (process.env.MARPIN_INTEGRATION_DATABASE !== "1") return false;
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      /(?:_test|_ci)$/.test(url.pathname.slice(1))
    );
  } catch {
    return false;
  }
}

const integrationTest = disposableDatabaseEnabled() ? test : test.skip;

integrationTest(
  "workspace bootstrap serializes the first owner and rejects seats over the plan cap",
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const slug = `auth-admission-${suffix}`;
    const firstIdentity = {
      clerkUserId: `user-first-${suffix}`,
      clerkOrgId: `org-${suffix}`,
      clerkOrgRole: "org:admin",
      suggestedName: "Concurrent workspace",
      slug,
    };
    const secondIdentity = {
      ...firstIdentity,
      clerkUserId: `user-second-${suffix}`,
    };

    try {
      const results = await Promise.allSettled([
        findOrCreateWorkspace(firstIdentity),
        findOrCreateWorkspace(secondIdentity),
      ]);
      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof findOrCreateWorkspace>>> =>
          result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(
        isWorkspaceSeatLimitError(rejected[0]?.reason),
        rejected[0]?.reason instanceof Error
          ? rejected[0].reason.stack
          : String(rejected[0]?.reason),
      );
      assert.equal(rejected[0]?.reason.code, "workspace_seat_limit");
      assert.equal(rejected[0]?.reason.maxSeats, 1);

      const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { slug },
      });
      const memberships = await prisma.membership.findMany({
        where: { workspaceId: workspace.id },
      });
      assert.equal(memberships.length, 1);
      assert.equal(memberships[0]?.role, "owner");

      const admittedIdentity =
        memberships[0]?.clerkUserId === firstIdentity.clerkUserId
          ? firstIdentity
          : secondIdentity;
      const retried = await findOrCreateWorkspace(admittedIdentity);
      assert.equal(retried.id, workspace.id);
      assert.equal(
        await prisma.membership.count({ where: { workspaceId: workspace.id } }),
        1,
      );

      await assert.rejects(
        () =>
          findOrCreateWorkspace({
            ...firstIdentity,
            clerkUserId: `user-third-${suffix}`,
          }),
        (error: unknown) =>
          error instanceof WorkspaceSeatLimitError &&
          error.workspaceId === workspace.id &&
          error.maxSeats === 1,
      );
    } finally {
      await prisma.workspace.deleteMany({ where: { slug } });
      await prisma.$disconnect();
    }
  },
);

integrationTest(
  "a regular organization member cannot bootstrap ownership before its admin",
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const slug = `auth-member-first-${suffix}`;
    const clerkOrgId = `org-${suffix}`;
    const memberIdentity = {
      clerkUserId: `member-${suffix}`,
      clerkOrgId,
      clerkOrgRole: "org:member",
      suggestedName: "Member-first workspace",
      slug,
    };
    const adminIdentity = {
      ...memberIdentity,
      clerkUserId: `admin-${suffix}`,
      clerkOrgRole: "org:admin",
    };

    try {
      await assert.rejects(
        () => findOrCreateWorkspace(memberIdentity),
        (error: unknown) =>
          error instanceof WorkspaceAdminRequiredError &&
          error.code === "workspace_admin_required",
      );

      assert.equal(
        await prisma.workspace.findUnique({
          where: { slug },
        }),
        null,
        "the denied bootstrap transaction must not leave an orphan workspace",
      );

      const admitted = await findOrCreateWorkspace(adminIdentity);
      const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { slug },
      });
      assert.equal(admitted.id, workspace.id);
      const memberships = await prisma.membership.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { createdAt: "asc" },
      });
      assert.equal(memberships.length, 1);
      assert.equal(memberships[0]?.clerkUserId, adminIdentity.clerkUserId);
      assert.equal(memberships[0]?.role, "owner");

      await assert.rejects(
        () => findOrCreateWorkspace(memberIdentity),
        (error: unknown) => isWorkspaceSeatLimitError(error),
      );

      const retried = await findOrCreateWorkspace(adminIdentity);
      assert.equal(retried.id, workspace.id);
      assert.equal(
        await prisma.membership.count({ where: { workspaceId: workspace.id } }),
        1,
      );
    } finally {
      await prisma.workspace.deleteMany({ where: { slug } });
      await prisma.$disconnect();
    }
  },
);

integrationTest("a personal workspace still bootstraps its user as owner", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = `auth-personal-${suffix}`;
  const identity = {
    clerkUserId: `personal-${suffix}`,
    clerkOrgId: null,
    clerkOrgRole: null,
    suggestedName: "Personal workspace",
    slug,
  };

  try {
    const workspace = await findOrCreateWorkspace(identity);
    const membership = await prisma.membership.findUniqueOrThrow({
      where: {
        workspaceId_clerkUserId: {
          workspaceId: workspace.id,
          clerkUserId: identity.clerkUserId,
        },
      },
    });
    assert.equal(membership.role, "owner");

    const retried = await findOrCreateWorkspace(identity);
    assert.equal(retried.id, workspace.id);
    assert.equal(
      await prisma.membership.count({ where: { workspaceId: workspace.id } }),
      1,
    );
  } finally {
    await prisma.workspace.deleteMany({ where: { slug } });
    await prisma.$disconnect();
  }
});

integrationTest(
  "an existing organization membership follows trusted Clerk role changes",
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const slug = `auth-existing-member-${suffix}`;
    const clerkUserId = `existing-member-${suffix}`;

    try {
      const workspace = await prisma.workspace.create({
        data: { name: "Existing member workspace", slug },
      });
      await prisma.membership.create({
        data: { workspaceId: workspace.id, clerkUserId, role: "admin" },
      });

      const demoted = await findOrCreateWorkspace({
        clerkUserId,
        clerkOrgId: `org-${suffix}`,
        clerkOrgRole: "org:member",
        suggestedName: "Ignored name",
        slug,
      });
      assert.equal(demoted.id, workspace.id);

      const demotedMembership = await prisma.membership.findUniqueOrThrow({
        where: {
          workspaceId_clerkUserId: { workspaceId: workspace.id, clerkUserId },
        },
      });
      assert.equal(demotedMembership.role, "member");

      const promoted = await findOrCreateWorkspace({
        clerkUserId,
        clerkOrgId: `org-${suffix}`,
        clerkOrgRole: "org:admin",
        suggestedName: "Ignored name",
        slug,
      });
      assert.equal(promoted.id, workspace.id);

      const promotedMembership = await prisma.membership.findUniqueOrThrow({
        where: {
          workspaceId_clerkUserId: { workspaceId: workspace.id, clerkUserId },
        },
      });
      assert.equal(promotedMembership.role, "admin");
      assert.equal(
        await prisma.membership.count({ where: { workspaceId: workspace.id } }),
        1,
      );
    } finally {
      await prisma.workspace.deleteMany({ where: { slug } });
      await prisma.$disconnect();
    }
  },
);

integrationTest(
  "an existing organization membership rejects a missing Clerk role claim",
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const slug = `auth-missing-role-${suffix}`;
    const clerkUserId = `missing-role-${suffix}`;

    try {
      const workspace = await prisma.workspace.create({
        data: { name: "Missing role workspace", slug },
      });
      await prisma.membership.create({
        data: { workspaceId: workspace.id, clerkUserId, role: "admin" },
      });

      await assert.rejects(
        () =>
          findOrCreateWorkspace({
            clerkUserId,
            clerkOrgId: `org-${suffix}`,
            clerkOrgRole: null,
            suggestedName: "Ignored name",
            slug,
          }),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "workspace_role_claim_invalid",
      );

      const membership = await prisma.membership.findUniqueOrThrow({
        where: {
          workspaceId_clerkUserId: { workspaceId: workspace.id, clerkUserId },
        },
      });
      assert.equal(membership.role, "admin");
    } finally {
      await prisma.workspace.deleteMany({ where: { slug } });
      await prisma.$disconnect();
    }
  },
);
