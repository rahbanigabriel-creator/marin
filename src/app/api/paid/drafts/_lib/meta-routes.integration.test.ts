import assert from "node:assert/strict";
import test from "node:test";
import { POST as checkMeta } from "../[draftId]/meta-check/route";
import { POST as reconcileMeta } from "../[draftId]/meta-reconcile/route";
import { POST as execute } from "../[draftId]/operations/route";
import { PaidProviderError } from "@/lib/connectors/paid-errors";
import { MetaPausedProviderError } from "@/lib/paid-drafts/meta-paused-provider";
import { paidDraftApiFailure } from "./http";

test("Meta check, recovery and execution reject cross-origin requests before auth or provider access", async () => {
  const previous = { VERCEL: process.env.VERCEL, APP_URL: process.env.APP_URL, NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL };
  Object.assign(process.env, { VERCEL: "1", APP_URL: "https://www.marpin.ai", NEXT_PUBLIC_APP_URL: "https://www.marpin.ai" });
  try {
    for (const route of [checkMeta, reconcileMeta, execute]) {
      const response = await route(new Request("https://www.marpin.ai/api/paid/drafts/test/meta-check", { method: "POST", headers: { origin: "https://attacker.example" } }), { params: Promise.resolve({ draftId: "test" }) });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "invalid_request_origin");
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("Meta access and verification failures are no-store, actionable and sanitized", async () => {
  for (const error of [new PaidProviderError("meta_ads", "permission", false), new MetaPausedProviderError("secret-token-value", true)]) {
    const response = paidDraftApiFailure(error, "test");
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = await response.json();
    assert.equal(body.code, "meta_check_failed");
    assert.equal(JSON.stringify(body).includes("secret-token-value"), false);
    assert.ok(body.message.length > 40);
  }
});
