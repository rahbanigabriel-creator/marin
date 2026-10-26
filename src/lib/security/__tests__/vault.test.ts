import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  decryptToken, encryptToken, isVaultConfigured, tokenAad,
  VaultDecryptError, VaultNotConfiguredError,
} from "../vault";

let previousKey: string | undefined;
beforeEach(() => {
  previousKey = process.env.TOKEN_ENC_KEY;
  process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
});
afterEach(() => {
  if (previousKey === undefined) delete process.env.TOKEN_ENC_KEY;
  else process.env.TOKEN_ENC_KEY = previousKey;
});

const account = {
  workspaceId: "test-workspace", platform: "test-provider",
  externalAccountId: "test-account", tokenKind: "access" as const,
};
const aad = tokenAad(account);

test("vault refuses missing and invalid encryption keys", () => {
  for (const key of [undefined, "invalid", Buffer.alloc(31).toString("base64")]) {
    if (key === undefined) delete process.env.TOKEN_ENC_KEY;
    else process.env.TOKEN_ENC_KEY = key;
    assert.equal(isVaultConfigured(), false);
    assert.throws(() => encryptToken("synthetic-token", aad), VaultNotConfiguredError);
  }
});

test("tokens round-trip with fresh encryption and retain legacy readability", () => {
  const first = encryptToken("synthetic-token", aad);
  const second = encryptToken("synthetic-token", aad);
  assert.match(first, /^v2\./);
  assert.notEqual(first, second);
  assert.equal(decryptToken(first, aad), "synthetic-token");
  assert.equal(decryptToken(second, aad), "synthetic-token");
  assert.equal(decryptToken(encryptToken("legacy-test-token")), "legacy-test-token");
});

test("tokens cannot cross workspace, account, provider or token-kind boundaries", () => {
  const blob = encryptToken("synthetic-token", aad);
  for (const changed of [
    { workspaceId: "other-workspace" }, { externalAccountId: "other-account" },
    { platform: "other-provider" }, { tokenKind: "refresh" as const },
  ]) {
    assert.throws(() => decryptToken(blob, tokenAad({ ...account, ...changed })), VaultDecryptError);
  }
  assert.throws(() => decryptToken(blob), VaultDecryptError);
});

test("modified ciphertext or authentication tag is refused without returning plaintext", () => {
  const blob = encryptToken("synthetic-token", aad);
  for (const index of [2, 3]) {
    const parts = blob.split(".");
    const bytes = Buffer.from(parts[index], "base64");
    bytes[0] ^= 1;
    parts[index] = bytes.toString("base64");
    assert.throws(() => decryptToken(parts.join("."), aad), VaultDecryptError);
  }
});

test("a different key and malformed envelopes fail closed", () => {
  const blob = encryptToken("synthetic-token", aad);
  process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 8).toString("base64");
  assert.throws(() => decryptToken(blob, aad), VaultDecryptError);
  for (const invalid of ["broken", "v3.a.b.c", "v2.a.b.c"]) {
    assert.throws(() => decryptToken(invalid, aad), VaultDecryptError);
  }
});
