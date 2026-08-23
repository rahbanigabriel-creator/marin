import assert from "node:assert/strict";
import test from "node:test";

import {
  signPendingSelection,
  signTransaction,
  verifyOAuthActorBinding,
  verifyPendingSelection,
  verifyTransaction,
  type OAuthTransaction,
} from "../oauth";

const SIGNING_KEY = Buffer.alloc(32, 7).toString("base64");
const originalSigningKey = process.env.TOKEN_ENC_KEY;

test.before(() => {
  process.env.TOKEN_ENC_KEY = SIGNING_KEY;
});

test.after(() => {
  if (originalSigningKey === undefined) delete process.env.TOKEN_ENC_KEY;
  else process.env.TOKEN_ENC_KEY = originalSigningKey;
});

test("signed OAuth transactions remain bound to the initiating workspace and user", () => {
  const signed = signTransaction({
    platform: "ga4",
    state: "state-1",
    workspaceId: "workspace-a",
    clerkUserId: "user-a",
    codeVerifier: "verifier-1",
  });
  assert.ok(signed);

  const transaction = verifyTransaction(signed);
  assert.ok(transaction);
  assert.equal(
    verifyOAuthActorBinding(transaction, {
      workspaceId: "workspace-a",
      clerkUserId: "user-a",
    }).ok,
    true,
  );
  assert.deepEqual(
    verifyOAuthActorBinding(transaction, {
      workspaceId: "workspace-b",
      clerkUserId: "user-a",
    }),
    { ok: false, status: "oauth_actor_mismatch" },
  );
  assert.deepEqual(
    verifyOAuthActorBinding(transaction, {
      workspaceId: "workspace-a",
      clerkUserId: "user-b",
    }),
    { ok: false, status: "oauth_actor_mismatch" },
  );
});

test("pending account selection remains bound after the provider callback", () => {
  const signed = signPendingSelection({
    platform: "google_ads",
    workspaceId: "workspace-a",
    clerkUserId: "user-a",
    encAccessToken: "encrypted-access-token",
    encRefreshToken: "encrypted-refresh-token",
  });
  assert.ok(signed);

  const pending = verifyPendingSelection(signed);
  assert.ok(pending);
  assert.equal(
    verifyOAuthActorBinding(pending, {
      workspaceId: "workspace-a",
      clerkUserId: "user-a",
    }).ok,
    true,
  );
  assert.deepEqual(
    verifyOAuthActorBinding(pending, {
      workspaceId: "workspace-b",
      clerkUserId: "user-a",
    }),
    { ok: false, status: "oauth_actor_mismatch" },
  );
  assert.deepEqual(
    verifyOAuthActorBinding(pending, {
      workspaceId: "workspace-a",
      clerkUserId: "user-b",
    }),
    { ok: false, status: "oauth_actor_mismatch" },
  );
});

test("legacy and tampered OAuth cookies fail closed", () => {
  const legacy = signTransaction({
    platform: "meta_ads",
    state: "legacy-state",
  } as OAuthTransaction);
  assert.ok(legacy);
  assert.equal(verifyTransaction(legacy), null);

  const signed = signTransaction({
    platform: "meta_ads",
    state: "state-2",
    workspaceId: "workspace-a",
    clerkUserId: "user-a",
  });
  assert.ok(signed);
  const tampered = `${signed.slice(0, -1)}${signed.endsWith("a") ? "b" : "a"}`;
  assert.equal(verifyTransaction(tampered), null);
});

test("local development uses the same actor-binding contract", () => {
  const signed = signTransaction({
    platform: "tiktok_ads",
    state: "dev-state",
    workspaceId: "dev-workspace",
    clerkUserId: "dev-user",
  });
  assert.ok(signed);

  const transaction = verifyTransaction(signed);
  assert.ok(transaction);
  assert.equal(
    verifyOAuthActorBinding(transaction, {
      workspaceId: "dev-workspace",
      clerkUserId: "dev-user",
    }).ok,
    true,
  );
});
