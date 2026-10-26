import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  deriveCodeChallenge, generateCodeVerifier, OAUTH_TX_MAX_AGE,
  signPendingSelection, signTransaction, statesMatch,
  verifyPendingSelection, verifyTransaction,
} from "../oauth";

let previousKey: string | undefined;
beforeEach(() => {
  previousKey = process.env.TOKEN_ENC_KEY;
  process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
});
afterEach(() => {
  if (previousKey === undefined) delete process.env.TOKEN_ENC_KEY;
  else process.env.TOKEN_ENC_KEY = previousKey;
});
const transaction = { platform: "test-provider", state: "synthetic-state", codeVerifier: "synthetic-verifier" };

test("PKCE matches the RFC 7636 S256 vector and generates fresh URL-safe verifiers", () => {
  assert.equal(deriveCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const first = generateCodeVerifier();
  assert.match(first, /^[A-Za-z0-9_-]{43,128}$/);
  assert.notEqual(first, generateCodeVerifier());
});

test("signed OAuth transaction round-trips and rejects altered payloads and signatures", () => {
  const cookie = signTransaction(transaction);
  assert.ok(cookie);
  assert.deepEqual(verifyTransaction(cookie), transaction);
  const [payload, signature] = cookie.split(".");
  const altered = Buffer.from(JSON.stringify({ ...transaction, state: "attacker-state" })).toString("base64url");
  assert.equal(verifyTransaction(`${altered}.${signature}`), null);
  assert.equal(verifyTransaction(`${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`), null);
  assert.equal(verifyTransaction("malformed"), null);
  assert.equal(verifyTransaction(undefined), null);
});

test("missing, invalid and changed keys cannot validate OAuth cookies", () => {
  const cookie = signTransaction(transaction);
  assert.ok(cookie);
  for (const key of [undefined, "invalid", Buffer.alloc(32, 8).toString("base64")]) {
    if (key === undefined) delete process.env.TOKEN_ENC_KEY;
    else process.env.TOKEN_ENC_KEY = key;
    assert.equal(verifyTransaction(cookie), null);
    if (key === undefined || key === "invalid") assert.equal(signTransaction(transaction), null);
  }
});

test("pending account-selection cookies expire and reject tampering", (t) => {
  const now = 1_800_000_000_000;
  const clock = t.mock.method(Date, "now", () => now);
  const selection = { platform: "test-provider", encAccessToken: "synthetic-encrypted-token" };
  const cookie = signPendingSelection(selection);
  assert.ok(cookie);
  assert.deepEqual(verifyPendingSelection(cookie), { ...selection, exp: now / 1000 + OAUTH_TX_MAX_AGE });
  assert.equal(verifyPendingSelection(`${cookie}x`), null);
  clock.mock.mockImplementation(() => now + (OAUTH_TX_MAX_AGE + 1) * 1000);
  assert.equal(verifyPendingSelection(cookie), null);
});

test("OAuth state must match exactly", () => {
  assert.equal(statesMatch("synthetic-state", "synthetic-state"), true);
  assert.equal(statesMatch("synthetic-state", "synthetic-statz"), false);
  assert.equal(statesMatch("synthetic-state", "short"), false);
});
