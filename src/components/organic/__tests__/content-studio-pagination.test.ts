import assert from "node:assert/strict";
import test from "node:test";

import type { ContentStudioItemDto } from "../../../lib/content/types";
import { collectContentPagesUntilTarget } from "../ContentStudio";

const NOW = "2026-08-21T12:00:00.000Z";

function studioItem(id: string): ContentStudioItemDto {
  return {
    contentItem: {
      id,
      brandId: "brand-1",
      planId: null,
      status: "draft",
      source: "manual",
      title: id,
      brief: null,
      coreCopy: null,
      objective: null,
      metadata: null,
      version: 1,
      approvedBy: null,
      approvedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    publications: [],
    assets: [],
  };
}

test("initial content on the first page causes no extra pagination", async () => {
  let calls = 0;
  const result = await collectContentPagesUntilTarget({
    firstPage: { items: [studioItem("target")], nextCursor: "unused" },
    targetContentId: "target",
    loadPage: async () => {
      calls += 1;
      return { items: [], nextCursor: null };
    },
  });

  assert.equal(calls, 0);
  assert.deepEqual(result.items.map((item) => item.contentItem.id), ["target"]);
  assert.equal(result.nextCursor, "unused");
});

test("initial content pagination stops on the page that contains the target and removes duplicates", async () => {
  const calls: string[] = [];
  const result = await collectContentPagesUntilTarget({
    firstPage: { items: [studioItem("newest")], nextCursor: "page-2" },
    targetContentId: "target",
    loadPage: async (cursor) => {
      calls.push(cursor);
      if (cursor === "page-2") {
        return {
          items: [studioItem("newest"), studioItem("middle")],
          nextCursor: "page-3",
        };
      }
      return {
        items: [studioItem("target")],
        nextCursor: "page-4-that-must-not-load",
      };
    },
  });

  assert.deepEqual(calls, ["page-2", "page-3"]);
  assert.deepEqual(result.items.map((item) => item.contentItem.id), [
    "newest",
    "middle",
    "target",
  ]);
  assert.equal(result.nextCursor, "page-4-that-must-not-load");
});

test("missing initial content exhausts the available cursor chain", async () => {
  const calls: string[] = [];
  const result = await collectContentPagesUntilTarget({
    firstPage: { items: [studioItem("newest")], nextCursor: "page-2" },
    targetContentId: "missing",
    loadPage: async (cursor) => {
      calls.push(cursor);
      return { items: [studioItem("oldest")], nextCursor: null };
    },
  });

  assert.deepEqual(calls, ["page-2"]);
  assert.equal(result.nextCursor, null);
  assert.deepEqual(result.items.map((item) => item.contentItem.id), ["newest", "oldest"]);
});

test("a repeated cursor is rejected instead of looping forever", async () => {
  await assert.rejects(
    () => collectContentPagesUntilTarget({
      firstPage: { items: [studioItem("newest")], nextCursor: "repeat" },
      targetContentId: "missing",
      loadPage: async () => ({ items: [], nextCursor: "repeat" }),
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Content pagination returned a repeated cursor.",
  );
});
