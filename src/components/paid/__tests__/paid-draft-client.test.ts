import assert from "node:assert/strict";
import test from "node:test";

import type { ContentAssetDto } from "@/lib/content/types";
import { MAX_SERVER_ASSET_BYTES } from "@/lib/storage/limits";

import type {
  PaidCampaignDraftDto,
  PaidCampaignOperationAttemptDto,
} from "@/lib/paid-drafts/dto";
import type { PaidCampaignSnapshotV1 } from "@/lib/paid-drafts/types";

import {
  confirmPaidDraftProviderPaused,
  createPaidDraft,
  generatePaidDraft,
  newPaidDraftRequestId,
  PaidDraftRequestLedger,
  recordPaidDraftExternalActivationOutcome,
  uploadPaidAsset,
} from "../paid-draft-client";

const ASSET: ContentAssetDto = {
  id: "asset_paid_upload",
  kind: "video",
  mimeType: "video/mp4",
  bytes: 5_000_000,
  filename: "launch.mp4",
  width: 1080,
  height: 1920,
  durationMs: 10_000,
  source: "upload",
  contentUrl: "/api/assets/asset_paid_upload/content",
  createdAt: "2026-08-21T12:00:00.000Z",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("small paid creatives use the bounded server upload", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    assert.equal(init?.method, "POST");
    assert.equal(init?.body instanceof FormData, true);
    return response({ asset: { ...ASSET, bytes: 100 } });
  };
  try {
    const file = new File([new Uint8Array(100)], "launch.mp4", { type: "video/mp4" });
    const uploaded = await uploadPaidAsset(file);
    assert.equal(uploaded.id, ASSET.id);
    assert.deepEqual(calls, ["/api/assets"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("large paid creatives use private reservation, upload, and retryable completion", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let completionAttempts = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url === "/api/assets/reservations") {
      assert.equal(init?.method, "POST");
      return response({ reservationId: "reservation_1", pathname: "workspace/asset", uploadUrl: "https://blob.example/upload" }, 201);
    }
    if (url === "https://blob.example/upload") {
      assert.equal(init?.method, "PUT");
      assert.equal(init?.headers && (init.headers as Record<string, string>)["Content-Type"], "video/mp4");
      return new Response(null, { status: 200 });
    }
    if (url === "/api/assets/reservations/reservation_1/complete") {
      completionAttempts += 1;
      return completionAttempts === 1
        ? response({ error: "direct_upload_pending", message: "Still settling" }, 503)
        : response({ asset: ASSET }, 201);
    }
    return response({ error: "unexpected" }, 500);
  };
  try {
    const file = new File(
      [new Uint8Array(MAX_SERVER_ASSET_BYTES + 1)],
      "launch.mp4",
      { type: "video/mp4" },
    );
    const uploaded = await uploadPaidAsset(file);
    assert.equal(uploaded.id, ASSET.id);
    assert.equal(completionAttempts, 2);
    assert.deepEqual(calls, [
      "/api/assets/reservations",
      "https://blob.example/upload",
      "/api/assets/reservations/reservation_1/complete",
      "/api/assets/reservations/reservation_1/complete",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("paid draft mutations use the caller-owned replay identity verbatim", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  const snapshot = {
    schemaVersion: 1,
    source: "manual",
    platform: "google_ads",
    template: "google_search_rsa",
    connection: {
      platform: "google_ads",
      connectionId: "connection_1",
      accountId: "account_1",
      accountName: "Founder Ads",
    },
    campaign: { name: "Founder search", objective: "traffic" },
    budget: { amountMinor: 5_000, currency: "EUR", cadence: "daily" },
    schedule: {
      startsAt: "2026-08-22T09:00:00+02:00",
      endsAt: "2026-08-29T18:00:00+02:00",
      timezone: "Europe/Madrid",
    },
    assumptions: [],
    adGroups: [{
      localId: "group_1",
      name: "Founders",
      targeting: {
        kind: "search",
        locations: ["Spain"],
        languages: ["English"],
        keywords: [{ text: "founder marketing", matchType: "exact" }],
        negativeKeywords: [],
      },
      ads: [{
        localId: "ad_1",
        name: "Founder RSA",
        format: "responsive_search",
        assetIds: [],
        headlines: ["Founder marketing system", "Plan your distribution", "Ship with a growth plan"],
        descriptions: ["Audit and plan your distribution in one place.", "Build a reviewable marketing plan before launch."],
        destinationUrl: "https://www.marpin.ai/",
        path1: null,
        path2: null,
      }],
    }],
  } satisfies PaidCampaignSnapshotV1;
  const draft = { id: "draft_1" } as PaidCampaignDraftDto;
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return response({ draft, credits: 3, model: "test" }, 201);
  };
  try {
    const replayId = "draft-create-fixed-replay-id";
    await createPaidDraft({ requestId: replayId, connectionId: "connection_1", snapshot });
    await createPaidDraft({ requestId: replayId, connectionId: "connection_1", snapshot });
    assert.deepEqual(bodies.map((body) => body.requestId), [replayId, replayId]);

    const generationId = "draft-generate-fixed-replay-id";
    await generatePaidDraft({
      requestId: generationId,
      connectionId: "connection_1",
      template: "google_search_rsa",
      instruction: "Founder launch",
    });
    assert.equal(bodies.at(-1)?.requestId, generationId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("new paid draft identities are bounded and unique", () => {
  const first = newPaidDraftRequestId("draft-generate");
  const second = newPaidDraftRequestId("draft-generate");
  assert.match(first, /^draft-generate-/);
  assert.ok(first.length <= 120);
  assert.notEqual(first, second);
});

test("the browser action ledger reuses a lost-response identity until success", () => {
  const ledger = new PaidDraftRequestLedger();
  const first = ledger.get("generate:account:template:brief", "draft-generate");
  const afterNetworkFailure = ledger.get("generate:account:template:brief", "draft-generate");
  assert.equal(afterNetworkFailure, first);

  ledger.complete("generate:account:template:brief");
  const nextLogicalAction = ledger.get("generate:account:template:brief", "draft-generate");
  assert.notEqual(nextLogicalAction, first);
});

test("provider-paused confirmation binds the exact draft and explicit assertion", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  const draft = {
    id: "draft_provider_1",
    version: 7,
    snapshotHash: "f".repeat(64),
  } as PaidCampaignDraftDto;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return response({ draft }, 201);
  };
  try {
    await confirmPaidDraftProviderPaused(
      draft,
      "281498962108233",
      "confirm-provider-paused-replay-id",
    );
    assert.equal(requestUrl, "/api/paid/drafts/draft_provider_1/provider-paused");
    assert.deepEqual(requestBody, {
      requestId: "confirm-provider-paused-replay-id",
      expectedVersion: 7,
      snapshotHash: "f".repeat(64),
      providerCampaignId: "281498962108233",
      confirmation: "I created this campaign in the provider and left it paused",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("external activation outcomes bind the exact pending handoff", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  const draft = {
    id: "draft_activation_1",
    version: 7,
    snapshotHash: "e".repeat(64),
  } as PaidCampaignDraftDto;
  const attempt = { id: "attempt_activation_1" } as PaidCampaignOperationAttemptDto;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return response({ draft }, 201);
  };
  try {
    await recordPaidDraftExternalActivationOutcome(
      draft,
      attempt,
      "not_activated",
      "record-activation-outcome-replay-id",
    );
    assert.equal(requestUrl, "/api/paid/drafts/draft_activation_1/activation-outcome");
    assert.deepEqual(requestBody, {
      requestId: "record-activation-outcome-replay-id",
      expectedVersion: 7,
      snapshotHash: "e".repeat(64),
      attemptId: "attempt_activation_1",
      outcome: "not_activated",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
