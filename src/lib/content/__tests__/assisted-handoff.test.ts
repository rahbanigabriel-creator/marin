import assert from "node:assert/strict";
import test from "node:test";

import {
  assistedHandoffCompletionEvidence,
  assistedHandoffRequestHash,
} from "../assisted-handoff";
import { ContentValidationError } from "../errors";
import {
  canonicalOrganicPermalink,
  openOrganicPlatformUrl,
} from "../handoff-policy";
import { parseAssistedHandoffBody } from "../validation";

const YOUTUBE_ID = "AbCdEf12_-3";

test("all seven organic destinations expose their honest assisted compose URL", () => {
  assert.deepEqual(
    Object.fromEntries(
      ["youtube", "instagram", "facebook", "tiktok", "snapchat", "reddit", "pinterest"]
        .map((platform) => [platform, openOrganicPlatformUrl(platform)]),
    ),
    {
      youtube: "https://studio.youtube.com/",
      instagram: "https://www.instagram.com/create/select/",
      facebook: "https://www.facebook.com/",
      tiktok: "https://www.tiktok.com/tiktokstudio/upload",
      snapchat: "https://profile.snapchat.com/",
      reddit: "https://www.reddit.com/submit",
      pinterest: "https://www.pinterest.com/pin-creation-tool/",
    },
  );
});

test("valid direct permalinks are accepted and canonicalized for every destination", () => {
  const valid = [
    ["youtube", `https://youtube.com/watch?v=${YOUTUBE_ID}`, `https://www.youtube.com/watch?v=${YOUTUBE_ID}`],
    ["youtube", `https://www.youtube.com/shorts/${YOUTUBE_ID}/`, `https://www.youtube.com/shorts/${YOUTUBE_ID}`],
    ["youtube", `https://youtube.com/live/${YOUTUBE_ID}`, `https://www.youtube.com/live/${YOUTUBE_ID}`],
    ["youtube", `https://youtu.be/${YOUTUBE_ID}`, `https://youtu.be/${YOUTUBE_ID}`],
    ["instagram", "https://instagram.com/reel/Abc_12/", "https://www.instagram.com/reel/Abc_12"],
    ["instagram", "https://instagram.com/p/Abc_12", "https://www.instagram.com/p/Abc_12"],
    ["instagram", "https://instagram.com/tv/Abc_12", "https://www.instagram.com/tv/Abc_12"],
    ["instagram", "https://www.instagram.com/stories/marpin.ai/12345", "https://www.instagram.com/stories/marpin.ai/12345"],
    ["facebook", "https://facebook.com/marpin/posts/12345", "https://www.facebook.com/marpin/posts/12345"],
    ["facebook", "https://www.facebook.com/marpin/videos/12345", "https://www.facebook.com/marpin/videos/12345"],
    ["facebook", "https://facebook.com/reel/12345", "https://www.facebook.com/reel/12345"],
    ["facebook", "https://facebook.com/permalink.php?story_fbid=123&id=456", "https://www.facebook.com/permalink.php?id=456&story_fbid=123"],
    ["tiktok", "https://tiktok.com/@marpin.ai/video/123456789", "https://www.tiktok.com/@marpin.ai/video/123456789"],
    ["snapchat", "https://snapchat.com/spotlight/abc_123", "https://www.snapchat.com/spotlight/abc_123"],
    ["snapchat", "https://www.snapchat.com/p/abc-123", "https://www.snapchat.com/p/abc-123"],
    ["reddit", "https://reddit.com/r/SaaS/comments/abc123/launch_week", "https://www.reddit.com/r/SaaS/comments/abc123/launch_week"],
    ["reddit", "https://redd.it/abc123", "https://redd.it/abc123"],
    ["pinterest", "https://pinterest.com/pin/123456789", "https://www.pinterest.com/pin/123456789"],
  ] as const;
  for (const [platform, input, expected] of valid) {
    assert.equal(canonicalOrganicPermalink(platform, input), expected);
  }
});

test("permalink policy rejects profile URLs, hostile hosts, ports, fragments, and extra query data", () => {
  const invalid = [
    ["youtube", `http://youtube.com/watch?v=${YOUTUBE_ID}`],
    ["youtube", `https://youtube.com.evil.test/watch?v=${YOUTUBE_ID}`],
    ["youtube", `https://youtube.com:443/watch?v=${YOUTUBE_ID}`],
    ["youtube", `https://user@youtube.com/watch?v=${YOUTUBE_ID}`],
    ["youtube", `https://youtube.com/watch?v=${YOUTUBE_ID}&utm_source=x`],
    ["youtube", `https://youtube.com/watch?v=${YOUTUBE_ID}#comments`],
    ["instagram", "https://instagram.com/marpin"],
    ["facebook", "https://facebook.com/marpin"],
    ["tiktok", "https://tiktok.com/@marpin.ai"],
    ["snapchat", "https://snapchat.com/add/marpin"],
    ["reddit", "https://reddit.com/r/SaaS"],
    ["pinterest", "https://pinterest.com/marpin"],
  ] as const;
  for (const [platform, value] of invalid) {
    assert.throws(
      () => canonicalOrganicPermalink(platform, value),
      (error: unknown) => error instanceof ContentValidationError && error.code === "invalid_permalink",
    );
  }
});

test("assisted handoff parsing bounds snapshot, key, and outcome-specific fields", () => {
  assert.deepEqual(parseAssistedHandoffBody({
    requestId: "handoff_123456",
    expectedContentVersion: 4,
    outcome: "failed",
    failureReason: "  Browser upload failed  ",
  }), {
    requestId: "handoff_123456",
    expectedContentVersion: 4,
    outcome: "failed",
    permalink: undefined,
    failureReason: "Browser upload failed",
  });
  assert.throws(
    () => parseAssistedHandoffBody({
      requestId: "handoff_123456",
      expectedContentVersion: 1,
      outcome: "completed",
    }),
    (error: unknown) =>
      error instanceof ContentValidationError && error.code === "invalid_permalink",
  );
  for (const body of [
    { requestId: "short", expectedContentVersion: 1, outcome: "completed" },
    { requestId: "handoff_123456", expectedContentVersion: 0, outcome: "completed" },
    { requestId: "handoff_123456", expectedContentVersion: 1, outcome: "published" },
    { requestId: "handoff_123456", expectedContentVersion: 1, outcome: "completed", failureReason: "No" },
    { requestId: "handoff_123456", expectedContentVersion: 1, outcome: "failed", permalink: "https://redd.it/abc" },
  ]) {
    assert.throws(() => parseAssistedHandoffBody(body), ContentValidationError);
  }
});

test("request hashes are deterministic, publication-bound, and semantic", () => {
  const request = {
    expectedContentVersion: 3,
    outcome: "completed" as const,
    permalink: "https://www.pinterest.com/pin/123",
    failureReason: null,
  };
  const hash = assistedHandoffRequestHash("publication-1", request);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, assistedHandoffRequestHash("publication-1", { ...request }));
  assert.notEqual(hash, assistedHandoffRequestHash("publication-2", request));
  assert.notEqual(hash, assistedHandoffRequestHash("publication-1", { ...request, expectedContentVersion: 4 }));
});

test("assisted success is explicitly user-confirmed rather than provider-confirmed publication", () => {
  assert.equal(assistedHandoffCompletionEvidence({
    publicationStatus: "published",
    attempts: [{ provider: "assisted", status: "succeeded", response: { kind: "user_attestation" } }],
  }), "user_confirmed_external_handoff");
  assert.equal(assistedHandoffCompletionEvidence({
    publicationStatus: "published",
    attempts: [],
  }), "unverified_external_completion");
  assert.equal(assistedHandoffCompletionEvidence({
    publicationStatus: "ready",
    attempts: [],
  }), "not_recorded");
});
