import assert from "node:assert/strict";
import test from "node:test";

import {
  DELETING_ASSET_STORAGE_PREFIX,
  deletingAssetStorageKey,
  evaluateStorageLimit,
  isPendingAssetStorageKey,
  isUnavailableAssetStorageKey,
  PENDING_ASSET_STORAGE_PREFIX,
  storageKeyFromDeletionMarker,
  STORAGE_UPGRADE_URL,
  StorageLimitExceededError,
} from "@/lib/billing/storage";

test("storage limit includes pending bytes and allows an exact-cap reservation", () => {
  assert.deepEqual(evaluateStorageLimit(200, 50, 250), {
    allowed: true,
    currentBytes: 200,
    requestedBytes: 50,
    limitBytes: 250,
    remainingBytes: 50,
  });

  assert.equal(evaluateStorageLimit(200, 51, 250).allowed, false);
  assert.equal(evaluateStorageLimit(249, 0, 250).allowed, true);
});

test("storage limit rejects unsafe or negative byte counters", () => {
  assert.throws(() => evaluateStorageLimit(-1, 1, 250), /currentBytes/);
  assert.throws(() => evaluateStorageLimit(0, -1, 250), /requestedBytes/);
  assert.throws(() => evaluateStorageLimit(0, 1, Number.MAX_SAFE_INTEGER + 1), /limitBytes/);
});

test("pending storage keys and typed upgrade errors are stable", () => {
  assert.equal(isPendingAssetStorageKey(`${PENDING_ASSET_STORAGE_PREFIX}request-id`), true);
  assert.equal(isPendingAssetStorageKey("https://blob.example/asset.png"), false);

  const error = new StorageLimitExceededError("free", 240, 20, 250);
  assert.equal(error.code, "storage_limit");
  assert.equal(error.actionUrl, STORAGE_UPGRADE_URL);
  assert.equal(error.actionUrl, "/settings/billing");
  assert.match(error.message, /Free storage allowance/);
});

test("asset deletion markers are reversible and unavailable to readers", () => {
  const pathname = "ws/workspace-1/asset-1/launch-proof.png";
  const marker = deletingAssetStorageKey(pathname);

  assert.equal(marker, `${DELETING_ASSET_STORAGE_PREFIX}${pathname}`);
  assert.equal(storageKeyFromDeletionMarker(marker), pathname);
  assert.equal(storageKeyFromDeletionMarker(pathname), null);
  assert.equal(isUnavailableAssetStorageKey(marker), true);
  assert.equal(isUnavailableAssetStorageKey(`${PENDING_ASSET_STORAGE_PREFIX}asset-1`), true);
  assert.equal(isUnavailableAssetStorageKey(pathname), false);
});
