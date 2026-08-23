import assert from "node:assert/strict";
import test from "node:test";

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
  "pre-release writers can still insert usage and publication attempts after expansion migrations",
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const usageId = `legacy-usage-${suffix}`;
    const attemptId = `legacy-attempt-${suffix}`;
    const workspace = await prisma.workspace.create({
      data: { name: "Rollback compatibility", slug: `rollback-${suffix}` },
    });

    try {
      const item = await prisma.contentItem.create({
        data: {
          workspaceId: workspace.id,
          title: "Legacy publication",
        },
      });
      const publication = await prisma.publication.create({
        data: {
          workspaceId: workspace.id,
          contentItemId: item.id,
          platform: "instagram",
          format: "post",
          body: "Legacy writer payload",
        },
      });

      await prisma.$executeRaw`
        INSERT INTO "usage_events" (
          "id", "workspace_id", "kind", "credits", "model", "created_at"
        ) VALUES (
          ${usageId}, ${workspace.id}, 'answer', 1.0::double precision,
          'legacy-model', CURRENT_TIMESTAMP
        )
      `;
      await prisma.$executeRaw`
        INSERT INTO "publication_attempts" (
          "id", "workspace_id", "publication_id", "provider",
          "idempotency_key", "status", "attempted_at"
        ) VALUES (
          ${attemptId}, ${workspace.id}, ${publication.id}, 'manual',
          ${`legacy-key-${suffix}`}, 'succeeded', CURRENT_TIMESTAMP
        )
      `;

      const usage = await prisma.usageEvent.findUniqueOrThrow({
        where: { id: usageId },
      });
      assert.match(usage.idempotencyKey, /^rollback:/);
      assert.equal(usage.requestHash.length, 64);
      assert.ok(usage.periodEnd > usage.periodStart);
      assert.ok(usage.updatedAt instanceof Date);

      const attempt = await prisma.publicationAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      assert.equal(attempt.requestHash.length, 64);
      assert.equal(attempt.contentVersion, 0);
    } finally {
      await prisma.workspace.delete({ where: { id: workspace.id } });
    }
  },
);
