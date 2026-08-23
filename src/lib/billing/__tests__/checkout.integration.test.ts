import assert from "node:assert/strict";
import test from "node:test";

import { withWorkspaceCheckoutLock } from "@/lib/billing/checkout";
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

integrationTest("workspace checkout locks serialize concurrent interval decisions", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Checkout lock", slug: `checkout-lock-${suffix}` },
  });

  let releaseFirst!: () => void;
  const holdFirst = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let markFirstEntered!: () => void;
  const firstEntered = new Promise<void>((resolve) => {
    markFirstEntered = resolve;
  });
  const entries: string[] = [];

  const first = withWorkspaceCheckoutLock(workspace.id, async () => {
    entries.push("monthly");
    markFirstEntered();
    await holdFirst;
  });

  let second: Promise<void> | undefined;
  try {
    await firstEntered;
    second = withWorkspaceCheckoutLock(workspace.id, async () => {
      entries.push("annual");
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(entries, ["monthly"], "the second request must wait on the workspace row");

    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(entries, ["monthly", "annual"]);
  } finally {
    releaseFirst();
    await Promise.allSettled([first, ...(second ? [second] : [])]);
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
