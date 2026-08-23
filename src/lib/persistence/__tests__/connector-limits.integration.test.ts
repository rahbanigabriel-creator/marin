import assert from "node:assert/strict";
import test from "node:test";

import { isEntitlementDeniedError } from "../../billing/errors";
import { persistEncryptedConnection } from "../../connectors/persist";
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

integrationTest("reactivating a revoked connector consumes a plan slot", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Connector limit", slug: `connector-limit-${suffix}` },
  });

  try {
    await prisma.connection.createMany({
      data: [
        {
          workspaceId: workspace.id,
          platform: "ga4",
          externalAccountId: "active-account",
          status: "connected",
          encAccessToken: "encrypted-active",
        },
        {
          workspaceId: workspace.id,
          platform: "meta_ads",
          externalAccountId: "revoked-account",
          status: "revoked",
          encAccessToken: "encrypted-revoked",
        },
      ],
    });

    await assert.rejects(
      () =>
        persistEncryptedConnection({
          workspaceId: workspace.id,
          platform: "meta_ads",
          externalAccountId: "revoked-account",
          encAccessToken: "encrypted-replacement",
        }),
      isEntitlementDeniedError,
    );
    assert.equal(
      (
        await prisma.connection.findUniqueOrThrow({
          where: {
            workspaceId_platform_externalAccountId: {
              workspaceId: workspace.id,
              platform: "meta_ads",
              externalAccountId: "revoked-account",
            },
          },
        })
      ).status,
      "revoked",
    );

    await prisma.connection.updateMany({
      where: { workspaceId: workspace.id, externalAccountId: "active-account" },
      data: { status: "revoked" },
    });
    await persistEncryptedConnection({
      workspaceId: workspace.id,
      platform: "meta_ads",
      externalAccountId: "revoked-account",
      encAccessToken: "encrypted-replacement",
    });
    assert.equal(
      await prisma.connection.count({
        where: { workspaceId: workspace.id, status: { not: "revoked" } },
      }),
      1,
    );
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.$disconnect();
  }
});

integrationTest("connected and error reconnects keep their existing slot", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Connector reconnect", slug: `connector-reconnect-${suffix}` },
  });

  try {
    for (const status of ["connected", "error"] as const) {
      await prisma.connection.upsert({
        where: {
          workspaceId_platform_externalAccountId: {
            workspaceId: workspace.id,
            platform: "ga4",
            externalAccountId: "same-account",
          },
        },
        update: { status },
        create: {
          workspaceId: workspace.id,
          platform: "ga4",
          externalAccountId: "same-account",
          status,
          encAccessToken: "encrypted-old",
        },
      });
      await persistEncryptedConnection({
        workspaceId: workspace.id,
        platform: "ga4",
        externalAccountId: "same-account",
        encAccessToken: `encrypted-${status}`,
      });
      const stored = await prisma.connection.findUniqueOrThrow({
        where: {
          workspaceId_platform_externalAccountId: {
            workspaceId: workspace.id,
            platform: "ga4",
            externalAccountId: "same-account",
          },
        },
      });
      assert.equal(stored.status, "connected");
      assert.equal(stored.encAccessToken, `encrypted-${status}`);
    }
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.$disconnect();
  }
});
