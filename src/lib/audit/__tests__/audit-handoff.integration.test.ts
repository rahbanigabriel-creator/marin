import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import type { Prisma } from "@prisma/client";

import {
  AUDIT_HANDOFF_TTL_MS,
  issueAuditHandoff,
  persistWorkspaceAudit,
} from "@/lib/audit/audit-handoff";
import type { SiteAuditResult } from "@/lib/audit/site";
import { prisma } from "@/lib/db";

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

function audit(finalUrl: string, title = "Handoff audit"): SiteAuditResult {
  return {
    sourceUrl: finalUrl,
    finalUrl,
    title,
    metaDescription: "A server-produced website audit.",
    canonical: finalUrl,
    lang: "en",
    headings: { h1: [title], h2: ["Distribution"], h1Count: 1, h2Count: 1 },
    wordCount: 640,
    links: { total: 18, internal: 15, external: 3 },
    images: { total: 4, withAlt: 3, withoutAlt: 1 },
    robots: {
      raw: "index,follow",
      directives: ["index", "follow"],
      indexAllowed: true,
      followAllowed: true,
    },
    jsonLdTypes: ["Organization"],
    jsonLdBlockCount: 1,
    invalidJsonLdBlockCount: 0,
    score: 84,
    findings: [
      {
        code: "missing-alt",
        category: "images",
        severity: "warning",
        title: "One image is missing alt text",
        evidence: "1 of 4 images has no alt text.",
        recommendation: "Add useful alt text to the image.",
        scoreImpact: 4,
      },
    ],
  };
}

function token(): string {
  return randomBytes(32).toString("base64url");
}

async function workspace(slug: string) {
  return prisma.workspace.create({ data: { name: "Audit handoff test", slug } });
}

async function cleanup(prefix: string): Promise<void> {
  await prisma.auditHandoff.deleteMany({ where: { finalUrl: { contains: prefix } } });
  await prisma.workspace.deleteMany({ where: { slug: { startsWith: prefix } } });
}

integrationTest(
  "a valid handoff stores only a token hash and is atomically consumed without crawling",
  async () => {
    const prefix = `audit-handoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const finalUrl = `https://${prefix}.example.com/`;
    const rawToken = token();
    const now = new Date("2026-08-21T12:00:00.000Z");
    try {
      const ownerWorkspace = await workspace(`${prefix}-owner`);
      const otherWorkspace = await workspace(`${prefix}-other`);
      const issued = await issueAuditHandoff(audit(finalUrl), {
        now: () => now,
        createToken: () => rawToken,
      });
      const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
      const stored = await prisma.auditHandoff.findUniqueOrThrow({ where: { tokenHash } });

      assert.equal(issued.token, rawToken);
      assert.equal(stored.tokenHash, tokenHash);
      assert.equal(JSON.stringify(stored).includes(rawToken), false);
      assert.equal(stored.finalUrl, finalUrl);
      assert.equal(stored.expiresAt.getTime(), now.getTime() + AUDIT_HANDOFF_TTL_MS);

      let crawlCalls = 0;
      const persisted = await persistWorkspaceAudit(
        { workspaceId: ownerWorkspace.id, requestedUrl: finalUrl, token: rawToken },
        {
          now: () => new Date(now.getTime() + 60_000),
          crawl: async () => {
            crawlCalls += 1;
            throw new Error("a valid handoff must not crawl again");
          },
        },
      );

      assert.equal(persisted.source, "handoff");
      assert.equal(crawlCalls, 0);
      assert.equal(persisted.brand.websiteUrl, finalUrl);
      const savedSnapshot = persisted.brand.auditSnapshot;
      assert.equal(
        savedSnapshot && typeof savedSnapshot === "object" && !Array.isArray(savedSnapshot)
          ? savedSnapshot.score
          : null,
        84,
      );
      assert.equal(await prisma.auditHandoff.count({ where: { tokenHash } }), 0);
      assert.equal(await prisma.brand.count({ where: { workspaceId: ownerWorkspace.id } }), 1);
      assert.equal(await prisma.brand.count({ where: { workspaceId: otherWorkspace.id } }), 0);

      const replay = await persistWorkspaceAudit(
        { workspaceId: ownerWorkspace.id, requestedUrl: finalUrl, token: rawToken },
        {
          now: () => new Date(now.getTime() + 90_000),
          crawl: async () => {
            crawlCalls += 1;
            return audit(finalUrl, "Fresh protected crawl");
          },
        },
      );
      assert.equal(replay.source, "crawl");
      assert.equal(crawlCalls, 1);
    } finally {
      await cleanup(prefix);
    }
  },
);

integrationTest(
  "mismatched and expired handoffs fail safely to a protected crawl",
  async () => {
    const prefix = `audit-fallback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const handoffUrl = `https://${prefix}.example.com/`;
    const requestedUrl = `https://other-${prefix}.example.com/`;
    const now = new Date("2026-08-21T13:00:00.000Z");
    try {
      const targetWorkspace = await workspace(`${prefix}-target`);
      const mismatchToken = token();
      await issueAuditHandoff(audit(handoffUrl), {
        now: () => now,
        createToken: () => mismatchToken,
      });
      let crawlCalls = 0;
      const mismatch = await persistWorkspaceAudit(
        {
          workspaceId: targetWorkspace.id,
          requestedUrl,
          token: mismatchToken,
        },
        {
          now: () => new Date(now.getTime() + 30_000),
          crawl: async (url) => {
            crawlCalls += 1;
            assert.equal(url, requestedUrl);
            return audit(requestedUrl, "Exact requested website");
          },
        },
      );
      assert.equal(mismatch.source, "crawl");
      assert.equal(mismatch.brand.websiteUrl, requestedUrl);

      const expiredToken = token();
      await issueAuditHandoff(audit(handoffUrl), {
        now: () => now,
        createToken: () => expiredToken,
      });
      const expired = await persistWorkspaceAudit(
        {
          workspaceId: targetWorkspace.id,
          requestedUrl: handoffUrl,
          token: expiredToken,
        },
        {
          now: () => new Date(now.getTime() + AUDIT_HANDOFF_TTL_MS + 1),
          crawl: async (url) => {
            crawlCalls += 1;
            return audit(url, "Expired handoff recrawl");
          },
        },
      );
      assert.equal(expired.source, "crawl");
      assert.equal(crawlCalls, 2);
      assert.equal(await prisma.auditHandoff.count({ where: { finalUrl: handoffUrl } }), 0);
    } finally {
      await cleanup(prefix);
    }
  },
);

integrationTest("concurrent consumers can reuse one handoff only once", async () => {
  const prefix = `audit-race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const finalUrl = `https://${prefix}.example.com/`;
  const rawToken = token();
  const now = new Date("2026-08-21T14:00:00.000Z");
  try {
    const firstWorkspace = await workspace(`${prefix}-first`);
    const secondWorkspace = await workspace(`${prefix}-second`);
    await issueAuditHandoff(audit(finalUrl), {
      now: () => now,
      createToken: () => rawToken,
    });

    const results = await Promise.all(
      [firstWorkspace, secondWorkspace].map((target, index) =>
        persistWorkspaceAudit(
          { workspaceId: target.id, requestedUrl: finalUrl, token: rawToken },
          {
            now: () => new Date(now.getTime() + 10_000),
            crawl: async () => audit(finalUrl, `Fallback crawl ${index + 1}`),
          },
        ),
      ),
    );

    assert.deepEqual(results.map((result) => result.source).sort(), ["crawl", "handoff"]);
    assert.equal(await prisma.auditHandoff.count({ where: { finalUrl } }), 0);
    assert.equal(await prisma.brand.count({ where: { workspaceId: firstWorkspace.id } }), 1);
    assert.equal(await prisma.brand.count({ where: { workspaceId: secondWorkspace.id } }), 1);
  } finally {
    await cleanup(prefix);
  }
});

for (const timezone of ["UTC", "Europe/Madrid", "America/New_York"]) {
  integrationTest(`handoff expiry is independent of database timezone (${timezone})`, async (t) => {
    const originalTransaction = prisma.$transaction;
    const transaction = prisma.$transaction.bind(prisma);
    // Set the zone on each actual transaction connection, not an arbitrary pool connection.
    prisma.$transaction = (async <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) =>
      transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('TimeZone', ${timezone}, true)`;
        return callback(tx);
      })) as typeof prisma.$transaction;
    t.after(() => { prisma.$transaction = originalTransaction; });
    const prefix = `audit-zone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const finalUrl = `https://${prefix}.example.com/`;
    const now = new Date("2026-08-21T12:00:00.000Z");
    try {
      const targetWorkspace = await workspace(`${prefix}-target`);
      let crawlCalls = 0;
      for (const elapsed of [AUDIT_HANDOFF_TTL_MS - 1, AUDIT_HANDOFF_TTL_MS, AUDIT_HANDOFF_TTL_MS + 1]) {
        const rawToken = token();
        await issueAuditHandoff(audit(finalUrl), {
          now: () => now,
          createToken: () => rawToken,
        });
        const persisted = await persistWorkspaceAudit(
          { workspaceId: targetWorkspace.id, requestedUrl: finalUrl, token: rawToken },
          {
            now: () => new Date(now.getTime() + elapsed),
            crawl: async () => {
              crawlCalls += 1;
              return audit(finalUrl, "Expired handoff recrawl");
            },
          },
        );
        assert.equal(persisted.source, elapsed < AUDIT_HANDOFF_TTL_MS ? "handoff" : "crawl");
        assert.equal(await prisma.auditHandoff.count({ where: { finalUrl } }), 0);
      }
      assert.equal(crawlCalls, 2);
    } finally {
      await cleanup(prefix);
    }
  });
}
