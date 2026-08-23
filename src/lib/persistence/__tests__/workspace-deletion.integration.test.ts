import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkspaceAuthorizationError,
  WorkspaceDeletionBlockedError,
  findOrCreateWorkspace,
  type ResolvedIdentity,
} from "../../auth";
import { prisma } from "../../db";
import {
  createWorkspaceDeletionRequest,
  getDeletionPreparation,
  getDeletionRequestForRequester,
  processWorkspaceDeletion,
  retryWorkspaceDeletion,
  type WorkspaceDeletionDependencies,
} from "../../privacy/deletion/service";
import {
  DeletionConflictError,
  DeletionNotFoundError,
  DeletionValidationError,
} from "../../privacy/deletion/errors";
import { deletionConfirmationPhrase } from "../../privacy/deletion/validation";

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

function identity(input: {
  userId: string;
  slug: string;
  orgId?: string | null;
  orgRole?: "org:admin" | "org:member" | null;
}): ResolvedIdentity {
  return {
    clerkUserId: input.userId,
    clerkOrgId: input.orgId ?? null,
    clerkOrgRole: input.orgId ? (input.orgRole ?? "org:admin") : null,
    suggestedName: "Deletion test workspace",
    slug: input.slug,
  };
}

async function createWorkspaceFixture(input: {
  slug: string;
  actorId: string;
  actorRole?: "owner" | "admin" | "member";
}) {
  const workspace = await prisma.workspace.create({
    data: { name: "Deletion test", slug: input.slug },
  });
  if (input.actorRole !== "owner") {
    await prisma.membership.create({
      data: {
        workspaceId: workspace.id,
        clerkUserId: `owner-${input.actorId}`,
        role: "owner",
      },
    });
  }
  await prisma.membership.create({
    data: {
      workspaceId: workspace.id,
      clerkUserId: input.actorId,
      role: input.actorRole ?? "owner",
    },
  });
  return workspace;
}

function dependencies(
  overrides: Partial<WorkspaceDeletionDependencies> = {},
): WorkspaceDeletionDependencies {
  return {
    now: () => new Date("2026-08-21T12:00:00.000Z"),
    dispatch: async () => "sent",
    cancelStripe: async () => "confirmed",
    revokeProviderGrants: async () => [],
    isAssetStorageConfigured: async () => true,
    deleteAsset: async () => undefined,
    deleteClerkUser: async () => "confirmed",
    ...overrides,
  };
}

async function cleanup(prefix: string): Promise<void> {
  await prisma.workspace.deleteMany({ where: { slug: { startsWith: prefix } } });
  await prisma.workspaceDeletionRequest.deleteMany({
    where: { workspaceSlug: { startsWith: prefix } },
  });
}

integrationTest(
  "only owners can request exact confirmed deletion; replay is strict and bootstrap is denied",
  async () => {
    const prefix = `delete-auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ownerId = `user-owner-${prefix}`;
    const ownerSlug = `${prefix}-owner`;
    const ownerIdentity = identity({ userId: ownerId, slug: ownerSlug });
    try {
      const workspace = await createWorkspaceFixture({ slug: ownerSlug, actorId: ownerId });
      const brand = await prisma.brand.create({
        data: { workspaceId: workspace.id, name: "Deletion brand", isPrimary: true },
      });
      const runId = `run-${prefix}`;
      await prisma.agentRun.create({
        data: {
          id: runId,
          workspaceId: workspace.id,
          brandId: brand.id,
          requestId: `agent-${prefix}`,
          requestHash: "a".repeat(64),
          mode: "organic",
          goal: "Prepare a plan",
          planKey: "organic_weekly_plan_v1",
          status: "running",
          limits: {
            maxSteps: 4,
            maxToolCalls: 4,
            maxModelTurns: 1,
            maxWebReads: 0,
            maxCredits: 1,
          },
          deadlineAt: new Date("2026-08-21T12:30:00.000Z"),
          createdBy: ownerId,
        },
      });
      const connection = await prisma.connection.create({
        data: {
          workspaceId: workspace.id,
          platform: "ga4",
          externalAccountId: `ga-${prefix}`,
          encAccessToken: "encrypted-access-token",
          encRefreshToken: "encrypted-refresh-token",
        },
      });

      await assert.rejects(
        () =>
          createWorkspaceDeletionRequest({
            identity: ownerIdentity,
            request: {
              requestId: `wrong-${prefix}`,
              confirmation: `delete ${ownerSlug}`,
            },
            dependencies: dependencies(),
          }),
        (error: unknown) =>
          error instanceof DeletionValidationError && error.code === "confirmation_mismatch",
      );

      const created = await createWorkspaceDeletionRequest({
        identity: ownerIdentity,
        request: {
          requestId: `request-${prefix}`,
          confirmation: deletionConfirmationPhrase(ownerSlug),
        },
        dependencies: dependencies({ dispatch: async () => "unavailable" }),
      });
      assert.equal(created.replayed, false);
      assert.equal(created.deletion.status, "needs_attention");
      assert.equal(created.deletion.failureCode, "dispatch_unavailable");
      assert.equal(
        (await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } })).status,
        "cancelled",
      );
      assert.equal(
        (await prisma.connection.findUniqueOrThrow({ where: { id: connection.id } })).status,
        "revoked",
      );

      const replay = await createWorkspaceDeletionRequest({
        identity: ownerIdentity,
        request: {
          requestId: `request-${prefix}`,
          confirmation: deletionConfirmationPhrase(ownerSlug),
        },
        dependencies: dependencies(),
      });
      assert.equal(replay.replayed, true);
      assert.equal(replay.deletion.id, created.deletion.id);
      await assert.rejects(
        () =>
          createWorkspaceDeletionRequest({
            identity: ownerIdentity,
            request: {
              requestId: `request-${prefix}`,
              confirmation: `${deletionConfirmationPhrase(ownerSlug)}!`,
            },
            dependencies: dependencies(),
          }),
        (error: unknown) =>
          error instanceof DeletionConflictError && error.code === "request_id_conflict",
      );
      await assert.rejects(
        () => findOrCreateWorkspace(ownerIdentity),
        (error: unknown) => error instanceof WorkspaceDeletionBlockedError,
      );

      for (const role of ["admin", "member"] as const) {
        const actorId = `user-${role}-${prefix}`;
        const slug = `${prefix}-${role}`;
        await createWorkspaceFixture({ slug, actorId, actorRole: role });
        await assert.rejects(
          () =>
            createWorkspaceDeletionRequest({
              identity: identity({ userId: actorId, slug }),
              request: {
                requestId: `request-${role}-${prefix}`,
                confirmation: deletionConfirmationPhrase(slug),
              },
              dependencies: dependencies(),
            }),
          (error: unknown) => error instanceof WorkspaceAuthorizationError,
        );
      }

      const demotedOwnerId = `user-demoted-owner-${prefix}`;
      const demotedOwnerSlug = `${prefix}-demoted-owner`;
      const demotedOwnerWorkspace = await createWorkspaceFixture({
        slug: demotedOwnerSlug,
        actorId: demotedOwnerId,
      });
      const demotedOwnerIdentity = identity({
        userId: demotedOwnerId,
        slug: demotedOwnerSlug,
        orgId: `org-${prefix}`,
        orgRole: "org:member",
      });
      const preparation = await getDeletionPreparation(demotedOwnerIdentity);
      assert.equal(preparation?.role, "member");
      assert.equal(
        (
          await prisma.membership.findUniqueOrThrow({
            where: {
              workspaceId_clerkUserId: {
                workspaceId: demotedOwnerWorkspace.id,
                clerkUserId: demotedOwnerId,
              },
            },
          })
        ).role,
        "member",
      );
      await assert.rejects(
        () =>
          createWorkspaceDeletionRequest({
            identity: demotedOwnerIdentity,
            request: {
              requestId: `request-demoted-owner-${prefix}`,
              confirmation: deletionConfirmationPhrase(demotedOwnerSlug),
            },
            dependencies: dependencies(),
          }),
        (error: unknown) => error instanceof WorkspaceAuthorizationError,
      );
    } finally {
      await cleanup(prefix);
    }
  },
);

integrationTest(
  "unconfirmed Stripe cancellation blocks deletion and requester retry is replay-safe",
  async () => {
    const prefix = `delete-stripe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userId = `user-${prefix}`;
    const actor = identity({ userId, slug: prefix });
    try {
      const workspace = await createWorkspaceFixture({ slug: prefix, actorId: userId });
      await prisma.subscription.create({
        data: {
          workspaceId: workspace.id,
          stripeCustomerId: `cus_${prefix}`,
          stripeSubId: `sub_${prefix}`,
          plan: "solo",
          status: "active",
        },
      });
      const created = await createWorkspaceDeletionRequest({
        identity: actor,
        request: {
          requestId: `create-${prefix}`,
          confirmation: deletionConfirmationPhrase(prefix),
        },
        dependencies: dependencies(),
      });
      let revokeCalled = false;
      const blocked = await processWorkspaceDeletion({
        deletionRequestId: created.deletion.id,
        workspaceId: workspace.id,
        dependencies: dependencies({
          cancelStripe: async () => "unavailable",
          revokeProviderGrants: async () => {
            revokeCalled = true;
            return [];
          },
        }),
      });
      assert.equal(blocked.status, "needs_attention");
      assert.equal(blocked.stripeStatus, "unavailable");
      assert.equal(revokeCalled, false);
      assert.ok(await prisma.workspace.findUnique({ where: { id: workspace.id } }));

      const retried = await retryWorkspaceDeletion({
        identity: actor,
        deletionRequestId: created.deletion.id,
        request: { requestId: `retry-${prefix}` },
        dependencies: dependencies(),
      });
      assert.equal(retried.replayed, false);
      assert.equal(retried.deletion.status, "queued");

      const completed = await processWorkspaceDeletion({
        deletionRequestId: created.deletion.id,
        workspaceId: workspace.id,
        dependencies: dependencies({ cancelStripe: async () => "confirmed" }),
      });
      assert.equal(completed.status, "completed");
      assert.equal(await prisma.workspace.findUnique({ where: { id: workspace.id } }), null);

      const replay = await retryWorkspaceDeletion({
        identity: actor,
        deletionRequestId: created.deletion.id,
        request: { requestId: `retry-${prefix}` },
        dependencies: dependencies(),
      });
      assert.equal(replay.replayed, true);
      assert.equal(replay.deletion.status, "completed");
      await assert.rejects(
        () =>
          retryWorkspaceDeletion({
            identity: actor,
            deletionRequestId: "different-deletion-request",
            request: { requestId: `retry-${prefix}` },
            dependencies: dependencies(),
          }),
        (error: unknown) =>
          error instanceof DeletionConflictError && error.code === "request_id_conflict",
      );
    } finally {
      await cleanup(prefix);
    }
  },
);

integrationTest("concurrent identical create requests converge on one tombstone and dispatch", async () => {
  const prefix = `delete-race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userId = `user-${prefix}`;
  const actor = identity({ userId, slug: prefix });
  try {
    await createWorkspaceFixture({ slug: prefix, actorId: userId });
    let dispatches = 0;
    const request = {
      identity: actor,
      request: {
        requestId: `create-${prefix}`,
        confirmation: deletionConfirmationPhrase(prefix),
      },
      dependencies: dependencies({
        dispatch: async () => {
          dispatches += 1;
          return "sent";
        },
      }),
    };
    const results = await Promise.all([
      createWorkspaceDeletionRequest(request),
      createWorkspaceDeletionRequest(request),
    ]);
    assert.equal(new Set(results.map((result) => result.deletion.id)).size, 1);
    assert.deepEqual(results.map((result) => result.replayed).sort(), [false, true]);
    assert.equal(dispatches, 1);
    assert.equal(
      await prisma.workspaceDeletionRequest.count({ where: { workspaceSlug: prefix } }),
      1,
    );
  } finally {
    await cleanup(prefix);
  }
});

integrationTest(
  "Blob availability and deletion confirmation block the local cascade until retry succeeds",
  async () => {
    const prefix = `delete-blob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userId = `user-${prefix}`;
    const actor = identity({ userId, slug: prefix });
    try {
      const workspace = await createWorkspaceFixture({ slug: prefix, actorId: userId });
      const asset = await prisma.asset.create({
        data: {
          workspaceId: workspace.id,
          kind: "image",
          mimeType: "image/png",
          bytes: 128,
          storageKey: `workspaces/${workspace.id}/assets/private.png`,
          filename: "private.png",
        },
      });
      const created = await createWorkspaceDeletionRequest({
        identity: actor,
        request: {
          requestId: `create-${prefix}`,
          confirmation: deletionConfirmationPhrase(prefix),
        },
        dependencies: dependencies(),
      });
      const unavailable = await processWorkspaceDeletion({
        deletionRequestId: created.deletion.id,
        workspaceId: workspace.id,
        dependencies: dependencies({ isAssetStorageConfigured: async () => false }),
      });
      assert.equal(unavailable.status, "needs_attention");
      assert.equal(unavailable.blobStatus, "unavailable");

      await retryWorkspaceDeletion({
        identity: actor,
        deletionRequestId: created.deletion.id,
        request: { requestId: `retry-one-${prefix}` },
        dependencies: dependencies(),
      });
      const failed = await processWorkspaceDeletion({
        deletionRequestId: created.deletion.id,
        workspaceId: workspace.id,
        dependencies: dependencies({ deleteAsset: async () => Promise.reject(new Error("nope")) }),
      });
      assert.equal(failed.status, "needs_attention");
      assert.equal(failed.blobStatus, "failed");

      await retryWorkspaceDeletion({
        identity: actor,
        deletionRequestId: created.deletion.id,
        request: { requestId: `retry-two-${prefix}` },
        dependencies: dependencies(),
      });
      const deletedKeys: string[] = [];
      const completed = await processWorkspaceDeletion({
        deletionRequestId: created.deletion.id,
        workspaceId: workspace.id,
        dependencies: dependencies({
          deleteAsset: async (input) => {
            assert.equal(input.assetId, asset.id);
            deletedKeys.push(input.storageKey);
          },
        }),
      });
      assert.equal(completed.status, "completed");
      assert.deepEqual(deletedKeys, [asset.storageKey]);
      assert.equal(await prisma.workspace.findUnique({ where: { id: workspace.id } }), null);
    } finally {
      await cleanup(prefix);
    }
  },
);

integrationTest(
  "provider revocation warnings are exposed; cascade retains billing evidence and requester-only tombstone",
  async () => {
    const prefix = `delete-cascade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userId = `user-${prefix}`;
    const actor = identity({ userId, slug: prefix });
    try {
      const workspace = await createWorkspaceFixture({ slug: prefix, actorId: userId });
      await prisma.connection.create({
        data: {
          workspaceId: workspace.id,
          platform: "tiktok_ads",
          externalAccountId: `tiktok-${prefix}`,
          encAccessToken: "ciphertext-only",
          encRefreshToken: "refresh-ciphertext-only",
        },
      });
      const billingEvent = await prisma.billingEvent.create({
        data: {
          workspaceId: workspace.id,
          stripeEventId: `evt_${prefix}`,
          type: "customer.subscription.updated",
          stripeCreatedAt: new Date("2026-08-20T10:00:00.000Z"),
        },
      });
      const created = await createWorkspaceDeletionRequest({
        identity: actor,
        request: {
          requestId: `create-${prefix}`,
          confirmation: deletionConfirmationPhrase(prefix),
        },
        dependencies: dependencies(),
      });

      await assert.rejects(
        () =>
          getDeletionRequestForRequester({
            deletionRequestId: created.deletion.id,
            clerkUserId: `other-${prefix}`,
          }),
        (error: unknown) => error instanceof DeletionNotFoundError,
      );
      await assert.rejects(
        () =>
          retryWorkspaceDeletion({
            identity: identity({ userId: `other-${prefix}`, slug: prefix }),
            deletionRequestId: created.deletion.id,
            request: { requestId: `wrong-tenant-${prefix}` },
            dependencies: dependencies(),
          }),
        (error: unknown) => error instanceof DeletionNotFoundError,
      );

      const completed = await processWorkspaceDeletion({
        deletionRequestId: created.deletion.id,
        workspaceId: workspace.id,
        dependencies: dependencies({
          revokeProviderGrants: async () => [
            { provider: "tiktok", status: "unavailable" },
          ],
        }),
      });
      assert.equal(completed.status, "completed_with_warnings");
      assert.deepEqual(completed.providerOutcomes, [
        { provider: "tiktok", status: "unavailable" },
      ]);
      assert.ok(completed.warningCodes.includes("tiktok_revocation_manual_required"));
      assert.equal(await prisma.workspace.findUnique({ where: { id: workspace.id } }), null);
      assert.ok(
        await prisma.workspaceDeletionRequest.findUnique({
          where: { id: created.deletion.id },
        }),
      );
      assert.equal(
        (
          await prisma.billingEvent.findUniqueOrThrow({ where: { id: billingEvent.id } })
        ).workspaceId,
        null,
      );
    } finally {
      await prisma.billingEvent.deleteMany({ where: { stripeEventId: { startsWith: `evt_${prefix}` } } });
      await cleanup(prefix);
    }
  },
);

integrationTest("Clerk organization workspaces never delete the shared user", async () => {
  const prefix = `delete-org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userId = `user-${prefix}`;
  const actor = identity({ userId, slug: prefix, orgId: `org-${prefix}` });
  try {
    const workspace = await createWorkspaceFixture({ slug: prefix, actorId: userId });
    const created = await createWorkspaceDeletionRequest({
      identity: actor,
      request: {
        requestId: `create-${prefix}`,
        confirmation: deletionConfirmationPhrase(prefix),
      },
      dependencies: dependencies(),
    });
    let clerkDeletes = 0;
    const completed = await processWorkspaceDeletion({
      deletionRequestId: created.deletion.id,
      workspaceId: workspace.id,
      dependencies: dependencies({
        deleteClerkUser: async () => {
          clerkDeletes += 1;
          return "confirmed";
        },
      }),
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.clerkStatus, "not_applicable");
    assert.equal(clerkDeletes, 0);
  } finally {
    await cleanup(prefix);
  }
});

integrationTest("personal users with another workspace membership are not deleted from Clerk", async () => {
  const prefix = `delete-shared-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userId = `user-${prefix}`;
  const actor = identity({ userId, slug: `${prefix}-personal` });
  try {
    const workspace = await createWorkspaceFixture({
      slug: `${prefix}-personal`,
      actorId: userId,
    });
    const shared = await prisma.workspace.create({
      data: { name: "Shared workspace", slug: `${prefix}-shared` },
    });
    await prisma.membership.create({
      data: { workspaceId: shared.id, clerkUserId: userId, role: "member" },
    });
    const created = await createWorkspaceDeletionRequest({
      identity: actor,
      request: {
        requestId: `create-${prefix}`,
        confirmation: deletionConfirmationPhrase(`${prefix}-personal`),
      },
      dependencies: dependencies(),
    });
    let clerkDeletes = 0;
    const completed = await processWorkspaceDeletion({
      deletionRequestId: created.deletion.id,
      workspaceId: workspace.id,
      dependencies: dependencies({
        deleteClerkUser: async () => {
          clerkDeletes += 1;
          return "confirmed";
        },
      }),
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.clerkStatus, "not_applicable");
    assert.equal(clerkDeletes, 0);
    assert.ok(await prisma.workspace.findUnique({ where: { id: shared.id } }));
  } finally {
    await cleanup(prefix);
  }
});
