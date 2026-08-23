import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceAuthorizationError } from "@/lib/auth";
import {
  parseCreatePaidDraftBody,
  parsePaidDraftListQuery,
} from "@/lib/paid-drafts/parsers";
import { PaidDraftValidationError } from "@/lib/paid-drafts/validation";
import { POST as createDraftRoute } from "../route";
import { paidDraftApiFailure } from "./http";

test("paid draft route rejects cross-origin mutations before persistence", async () => {
  const previous = {
    VERCEL: process.env.VERCEL,
    APP_URL: process.env.APP_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
  process.env.VERCEL = "1";
  process.env.APP_URL = "https://www.marpin.ai";
  process.env.NEXT_PUBLIC_APP_URL = "https://www.marpin.ai";
  try {
    const response = await createDraftRoute(new Request(
      "https://www.marpin.ai/api/paid/drafts",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        body: "{}",
      },
    ));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "forbidden",
      code: "invalid_request_origin",
    });
  } finally {
    if (previous.VERCEL === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous.VERCEL;
    if (previous.APP_URL === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous.APP_URL;
    if (previous.NEXT_PUBLIC_APP_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previous.NEXT_PUBLIC_APP_URL;
  }
});

test("paid draft HTTP boundary maps read-only members to a stable 403", async () => {
  const response = paidDraftApiFailure(
    new WorkspaceAuthorizationError(),
    "test",
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "forbidden",
    code: "forbidden",
    message: "Owner or admin access is required for this paid campaign operation",
  });
});

test("paid draft bodies and queries reject unknown or repeated fields", () => {
  assert.throws(
    () => parseCreatePaidDraftBody({
      requestId: "request-create-1",
      connectionId: "connection_1",
      snapshot: {},
      providerCampaignId: "untrusted",
    }),
    (error: unknown) =>
      error instanceof PaidDraftValidationError &&
      error.code === "unknown_field",
  );
  assert.throws(
    () => parsePaidDraftListQuery(new Request(
      "https://www.marpin.ai/api/paid/drafts?state=draft&state=ready",
    )),
    /repeated parameter/,
  );
  assert.throws(
    () => parsePaidDraftListQuery(new Request(
      "https://www.marpin.ai/api/paid/drafts?token=secret",
    )),
    /unsupported or repeated parameter/,
  );
});
