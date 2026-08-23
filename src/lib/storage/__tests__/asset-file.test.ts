import assert from "node:assert/strict";
import test from "node:test";

import {
  claimedMimeMatches,
  detectAssetFile,
  kindForClaimedAssetMime,
  normalizeClaimedAssetMime,
  safeAssetDownloadFilename,
  verifyStoredAsset,
} from "../asset-file";

test("creative files are detected from signatures instead of browser claims", () => {
  assert.deepEqual(
    detectAssetFile(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    { kind: "image", mimeType: "image/png", extension: "png" },
  );
  assert.deepEqual(
    detectAssetFile(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])),
    { kind: "image", mimeType: "image/jpeg", extension: "jpg" },
  );
  assert.deepEqual(
    detectAssetFile(Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])),
    { kind: "video", mimeType: "video/mp4", extension: "mp4" },
  );
  assert.equal(detectAssetFile(new TextEncoder().encode("<svg onload=alert(1)>")), null);
});

test("download filenames are safe ASCII basenames with bounded length", () => {
  assert.equal(safeAssetDownloadFilename("../../campaign/launch \"final\".png"), "launch final.png");
  assert.equal(safeAssetDownloadFilename("..\\..\\réel?.mp4"), "reel-.mp4");
  assert.equal(safeAssetDownloadFilename("..."), "marpin-asset");
  assert.equal(safeAssetDownloadFilename("x".repeat(200) + ".png").length, 120);
});

test("claimed MIME types must agree with detected bytes", () => {
  assert.equal(claimedMimeMatches("image/png", "image/png"), true);
  assert.equal(claimedMimeMatches("image/jpg", "image/jpeg"), true);
  assert.equal(claimedMimeMatches("application/octet-stream", "video/mp4"), true);
  assert.equal(claimedMimeMatches("image/png", "video/mp4"), false);
});

test("direct upload claims are normalized before quota reservation", () => {
  assert.equal(normalizeClaimedAssetMime(" IMAGE/JPG "), "image/jpeg");
  assert.equal(kindForClaimedAssetMime("video/quicktime"), "video");
  assert.equal(kindForClaimedAssetMime("image/webp"), "image");
  assert.equal(normalizeClaimedAssetMime("image/svg+xml"), null);
  assert.equal(kindForClaimedAssetMime("text/html"), null);
});

test("direct uploads finalize only when size, signature, and stored type agree", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(
    verifyStoredAsset({
      expectedBytes: 8,
      expectedKind: "image",
      expectedMimeType: "image/png",
      storedBytes: 8,
      storedContentType: "image/png",
      prefix: png,
    })?.mimeType,
    "image/png",
  );
  assert.equal(verifyStoredAsset({
    expectedBytes: 9,
    expectedKind: "image",
    expectedMimeType: "image/png",
    storedBytes: 8,
    storedContentType: "image/png",
    prefix: png,
  }), null);
  assert.equal(verifyStoredAsset({
    expectedBytes: 8,
    expectedKind: "video",
    expectedMimeType: "video/mp4",
    storedBytes: 8,
    storedContentType: "video/mp4",
    prefix: png,
  }), null);
  assert.equal(verifyStoredAsset({
    expectedBytes: 8,
    expectedKind: "image",
    expectedMimeType: "image/png",
    storedBytes: 8,
    storedContentType: "text/html",
    prefix: png,
  }), null);
});
