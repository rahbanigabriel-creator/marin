import assert from "node:assert/strict";
import test from "node:test";

import { ContentValidationError } from "../errors";
import {
  CONTENT_STUDIO_DEFAULT_PAGE_SIZE,
  CONTENT_STUDIO_MAX_PAGE_SIZE,
  contentStudioPageSize,
  decodeContentStudioCursor,
  encodeContentStudioCursor,
} from "../service";

test("Content Studio cursors round-trip the stable updatedAt and id boundary", () => {
  const updatedAt = new Date("2026-08-21T12:34:56.789Z");
  const cursor = encodeContentStudioCursor(updatedAt, "content_item-123");

  assert.deepEqual(decodeContentStudioCursor(cursor), {
    updatedAt,
    id: "content_item-123",
  });
});

test("Content Studio rejects malformed and oversized cursors", () => {
  for (const cursor of [
    "not-a-cursor",
    Buffer.from(JSON.stringify([2, "2026-08-21T12:34:56.789Z", "item-1"])).toString("base64url"),
    Buffer.from(JSON.stringify([1, "not-a-date", "item-1"])).toString("base64url"),
    "a".repeat(513),
  ]) {
    assert.throws(
      () => decodeContentStudioCursor(cursor),
      (error: unknown) =>
        error instanceof ContentValidationError && error.code === "invalid_cursor",
    );
  }
});

test("Content Studio page sizes are bounded", () => {
  assert.equal(contentStudioPageSize(), CONTENT_STUDIO_DEFAULT_PAGE_SIZE);
  assert.equal(contentStudioPageSize(1), 1);
  assert.equal(
    contentStudioPageSize(CONTENT_STUDIO_MAX_PAGE_SIZE),
    CONTENT_STUDIO_MAX_PAGE_SIZE,
  );
  for (const take of [0, CONTENT_STUDIO_MAX_PAGE_SIZE + 1, 1.5, Number.NaN]) {
    assert.throws(
      () => contentStudioPageSize(take),
      (error: unknown) =>
        error instanceof ContentValidationError && error.code === "invalid_page_size",
    );
  }
});
