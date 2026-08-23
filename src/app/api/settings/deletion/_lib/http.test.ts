import assert from "node:assert/strict";
import test from "node:test";

import { POST as createDeletionRoute } from "@/app/api/settings/deletion/route";
import { deletionApiFailure } from "@/app/api/settings/deletion/_lib/http";
import {
  AuthConfigurationRequiredError,
  WorkspaceAuthorizationError,
} from "@/lib/auth";
import {
  DeletionConflictError,
  DeletionNotFoundError,
  DeletionValidationError,
} from "@/lib/privacy/deletion/errors";

test("workspace deletion rejects cross-origin mutation before auth or persistence", async () => {
  const previous = {
    VERCEL: process.env.VERCEL,
    APP_URL: process.env.APP_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
  process.env.VERCEL = "1";
  process.env.APP_URL = "https://www.marpin.ai";
  process.env.NEXT_PUBLIC_APP_URL = "https://www.marpin.ai";
  try {
    const response = await createDeletionRoute(
      new Request("https://www.marpin.ai/api/settings/deletion", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        body: JSON.stringify({
          requestId: "delete_request_123",
          confirmation: "DELETE user-test",
        }),
      }),
    );
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      error: "forbidden",
      code: "invalid_request_origin",
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("deletion HTTP failures distinguish owner, validation, replay, and keyless mode", async () => {
  const owner = deletionApiFailure(new WorkspaceAuthorizationError(), "test");
  assert.equal(owner.status, 403);
  assert.equal((await owner.json()).code, "owner_required");

  const invalid = deletionApiFailure(
    new DeletionValidationError("confirmation_mismatch", "Mismatch"),
    "test",
  );
  assert.equal(invalid.status, 422);
  assert.equal((await invalid.json()).code, "confirmation_mismatch");

  const conflict = deletionApiFailure(
    new DeletionConflictError("request_id_conflict", "Conflict"),
    "test",
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "request_id_conflict");

  const missing = deletionApiFailure(new DeletionNotFoundError(), "test");
  assert.equal(missing.status, 404);

  const keyless = deletionApiFailure(new AuthConfigurationRequiredError(), "test");
  assert.equal(keyless.status, 503);
  assert.equal((await keyless.json()).code, "auth_configuration_required");
});
