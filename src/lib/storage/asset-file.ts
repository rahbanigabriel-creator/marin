export interface DetectedAssetFile {
  kind: "image" | "video";
  mimeType: string;
  extension: string;
}

export interface StoredAssetVerificationInput {
  expectedBytes: number;
  expectedKind: "image" | "video";
  expectedMimeType: string;
  storedBytes: number;
  storedContentType: string;
  prefix: Uint8Array;
}

const MAX_DOWNLOAD_FILENAME = 120;

export function safeAssetDownloadFilename(value: string | null | undefined): string {
  const basename = (value ?? "")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1) ?? "";
  const asciiName = basename
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["'`;]/g, "")
    .replace(/[<>:|?*]/g, "-")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/g, "")
    .trim();
  const safe = asciiName || "marpin-asset";
  if (safe.length <= MAX_DOWNLOAD_FILENAME) return safe;
  const dot = safe.lastIndexOf(".");
  const extension = dot > 0 && safe.length - dot <= 12 ? safe.slice(dot) : "";
  return `${safe.slice(0, MAX_DOWNLOAD_FILENAME - extension.length).replace(/[. ]+$/g, "")}${extension}`;
}

const CLAIMED_ASSET_MIME_TYPES = new Map<string, "image" | "video">([
  ["image/png", "image"],
  ["image/jpeg", "image"],
  ["image/jpg", "image"],
  ["image/webp", "image"],
  ["image/gif", "image"],
  ["video/mp4", "video"],
  ["video/quicktime", "video"],
  ["video/webm", "video"],
]);

export function normalizeClaimedAssetMime(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!CLAIMED_ASSET_MIME_TYPES.has(normalized)) return null;
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

export function kindForClaimedAssetMime(value: string): "image" | "video" | null {
  const normalized = value.trim().toLowerCase();
  return CLAIMED_ASSET_MIME_TYPES.get(normalized) ?? null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

/** Detect a conservative set of browser-safe creative formats from their bytes. */
export function detectAssetFile(bytes: Uint8Array): DetectedAssetFile | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: "image", mimeType: "image/png", extension: "png" };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { kind: "image", mimeType: "image/jpeg", extension: "jpg" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return { kind: "image", mimeType: "image/webp", extension: "webp" };
  }
  const gif = ascii(bytes, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") {
    return { kind: "image", mimeType: "image/gif", extension: "gif" };
  }
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12).toLowerCase();
    if (brand === "qt  ") {
      return { kind: "video", mimeType: "video/quicktime", extension: "mov" };
    }
    return { kind: "video", mimeType: "video/mp4", extension: "mp4" };
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { kind: "video", mimeType: "video/webm", extension: "webm" };
  }
  return null;
}

export function claimedMimeMatches(
  claimedMime: string,
  detectedMime: string,
): boolean {
  const normalized = claimedMime.trim().toLowerCase();
  if (!normalized || normalized === "application/octet-stream") return true;
  if (normalized === "image/jpg") return detectedMime === "image/jpeg";
  return normalized === detectedMime;
}

/** Verify direct-upload metadata against the actual private object signature. */
export function verifyStoredAsset(
  input: StoredAssetVerificationInput,
): DetectedAssetFile | null {
  if (input.storedBytes !== input.expectedBytes) return null;
  const detected = detectAssetFile(input.prefix);
  if (!detected || detected.kind !== input.expectedKind) return null;
  if (!claimedMimeMatches(input.expectedMimeType, detected.mimeType)) return null;
  if (!claimedMimeMatches(input.storedContentType, detected.mimeType)) return null;
  return detected;
}
