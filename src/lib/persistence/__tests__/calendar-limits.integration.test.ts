import assert from "node:assert/strict";
import test from "node:test";

import {
  createCalendarPublication,
  moveCalendarPublication,
} from "../../billing/calendar";
import { isEntitlementDeniedError } from "../../billing/errors";
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

integrationTest("future calendar entries serialize the Free plan cap", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Calendar entitlement", slug: `calendar-limit-${suffix}` },
  });
  const items = await Promise.all(
    Array.from({ length: 12 }, (_, index) => prisma.contentItem.create({
      data: {
        workspaceId: workspace.id,
        title: `Launch sequence ${index + 1}`,
        source: "manual",
      },
    })),
  );
  const now = new Date("2026-07-20T12:00:00.000Z");
  const destinations = [
    { platform: "instagram", format: "post" },
    { platform: "facebook", format: "post" },
    { platform: "tiktok", format: "video" },
    { platform: "reddit", format: "post" },
    { platform: "pinterest", format: "pin" },
  ] as const;

  try {
    const attempts = await Promise.allSettled(
      Array.from({ length: 11 }, (_, index) => {
        const destination = destinations[index % destinations.length];
        return createCalendarPublication({
          workspaceId: workspace.id,
          contentItemId: items[index]!.id,
          actorRole: "owner",
          expectedVersion: 1,
          platform: destination.platform,
          format: destination.format,
          body: `Calendar post ${index + 1}`,
          scheduledAt: new Date(now.getTime() + (index + 1) * 60 * 60 * 1_000),
          now,
        });
      }),
    );
    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    assert.equal(fulfilled.length, 10);
    assert.equal(rejected.length, 1);
    assert.equal(isEntitlementDeniedError(rejected[0]?.reason), true);
    assert.equal(rejected[0]?.reason.code, "scheduled_post_limit");
    assert.equal(await prisma.publication.count({ where: { workspaceId: workspace.id } }), 10);

    const existing = fulfilled[0]?.value;
    assert.ok(existing);
    await moveCalendarPublication({
      workspaceId: workspace.id,
      publicationId: existing.publication.id,
      actorRole: "owner",
      expectedVersion: existing.contentItem.version,
      scheduledAt: new Date(now.getTime() + 48 * 60 * 60 * 1_000),
      now,
    });

    const unscheduled = await createCalendarPublication({
      workspaceId: workspace.id,
      contentItemId: items[11]!.id,
      actorRole: "owner",
      expectedVersion: 1,
      platform: "youtube",
      format: "short",
      body: "Unscheduled draft",
      scheduledAt: null,
      now,
    });
    await assert.rejects(
      () =>
        moveCalendarPublication({
          workspaceId: workspace.id,
          publicationId: unscheduled.publication.id,
          actorRole: "owner",
          expectedVersion: unscheduled.contentItem.version,
          scheduledAt: new Date(now.getTime() + 72 * 60 * 60 * 1_000),
          now,
        }),
      isEntitlementDeniedError,
    );
    assert.equal(
      (await prisma.publication.findUniqueOrThrow({
        where: { id: unscheduled.publication.id },
      })).scheduledAt,
      null,
    );
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.$disconnect();
  }
});
