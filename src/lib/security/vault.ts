import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Token vault — AES-256-GCM authenticated encryption for connected-account
 * OAuth tokens (Stack B). Server-only.
 *
 * Mirrors the graceful-without-keys pattern in src/lib/agent/provider.ts and
 * src/lib/db.ts: the 32-byte key is read LAZILY from env on each call, never at
 * import/build time. Importing this module with no TOKEN_ENC_KEY set is safe
 * and `npm run build` stays green; only an actual encrypt/decrypt call without
 * a valid key throws (VaultNotConfiguredError). Feature-detect with
 * isVaultConfigured() before persisting tokens.
 *
 * Encrypted blob format (self-describing, versioned):
 *   "v1.<ivBase64>.<authTagBase64>.<ciphertextBase64>"
 *
 * Generate a key (32 random bytes, base64) and set it as TOKEN_ENC_KEY:
 *   openssl rand -base64 32
 *
 * Never log plaintext tokens or the key. EU data residency is unaffected —
 * this is local symmetric crypto with no network calls.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce length
const AUTH_TAG_BYTES = 16; // GCM tag length
const BLOB_VERSION = "v1";
const AAD_BLOB_VERSION = "v2";
const ENV_KEY = "TOKEN_ENC_KEY";

/** Thrown when encrypt/decrypt is called without a valid 32-byte TOKEN_ENC_KEY. */
export class VaultNotConfiguredError extends Error {
  constructor(detail?: string) {
    super(
      `${ENV_KEY} is not configured` +
        (detail ? `: ${detail}` : "") +
        ". Generate one with: openssl rand -base64 32",
    );
    this.name = "VaultNotConfiguredError";
  }
}

/** Thrown when a blob is malformed or fails authentication on decrypt. */
export class VaultDecryptError extends Error {
  constructor(detail: string) {
    super(`Failed to decrypt token: ${detail}`);
    this.name = "VaultDecryptError";
  }
}

/**
 * Decode TOKEN_ENC_KEY (base64) into a 32-byte key, or null if absent/invalid.
 * Read lazily so import/build never depends on env. Never logs the key.
 */
function readKey(): Buffer | null {
  const raw = process.env[ENV_KEY];
  if (!raw) return null;
  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, "base64");
  } catch {
    return null;
  }
  if (decoded.length !== KEY_BYTES) return null;
  return decoded;
}

/**
 * True when TOKEN_ENC_KEY is present and decodes to exactly 32 bytes. Use this
 * to gate any token-persistence path so the app stays green without a key.
 */
export function isVaultConfigured(): boolean {
  return readKey() !== null;
}

/** Read the key or throw VaultNotConfiguredError. Lazy — never called at import. */
function requireKey(): Buffer {
  const key = readKey();
  if (!key) {
    const raw = process.env[ENV_KEY];
    throw new VaultNotConfiguredError(
      raw ? `${ENV_KEY} must decode to ${KEY_BYTES} bytes (base64)` : undefined,
    );
  }
  return key;
}

/**
 * Encrypt a plaintext token with AES-256-GCM. Returns a self-describing blob:
 *   "v1.<ivBase64>.<authTagBase64>.<ciphertextBase64>"
 * A fresh 12-byte random IV is generated per call. Throws
 * VaultNotConfiguredError if no valid key is configured.
 */
export function encryptToken(plaintext: string, aad?: string): string {
  const key = requireKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    aad ? AAD_BLOB_VERSION : BLOB_VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/**
 * Decrypt a blob produced by encryptToken, verifying the GCM auth tag. Throws
 * VaultNotConfiguredError if no valid key is configured, or VaultDecryptError
 * if the blob is malformed or fails authentication (tampering / wrong key).
 */
export function decryptToken(blob: string, aad?: string): string {
  const key = requireKey();

  const parts = blob.split(".");
  if (parts.length !== 4) {
    throw new VaultDecryptError("malformed blob (expected 4 segments)");
  }
  const [version, ivB64, authTagB64, ciphertextB64] = parts;
  if (version !== BLOB_VERSION && version !== AAD_BLOB_VERSION) {
    throw new VaultDecryptError(`unsupported blob version "${version}"`);
  }
  if (version === AAD_BLOB_VERSION && !aad) {
    throw new VaultDecryptError("AAD is required for this blob");
  }

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  if (iv.length !== IV_BYTES) {
    throw new VaultDecryptError("invalid IV length");
  }
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new VaultDecryptError("invalid auth tag length");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    if (version === AAD_BLOB_VERSION) decipher.setAAD(Buffer.from(aad ?? "", "utf8"));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(), // throws if the auth tag does not verify
    ]);
    return plaintext.toString("utf8");
  } catch {
    // Do not leak crypto internals or any token material in the message.
    throw new VaultDecryptError("authentication failed (tampered or wrong key)");
  }
}

export function tokenAad(input: {
  workspaceId: string;
  platform: string;
  externalAccountId: string;
  tokenKind: "access" | "refresh";
}): string {
  return [
    "marin-token-v1",
    input.workspaceId,
    input.platform,
    input.externalAccountId,
    input.tokenKind,
  ].join(":");
}

/**
 * Constant-time equality for two encoded blobs / tokens. Exposed for callers
 * that compare secret material without leaking length/content via timing.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
