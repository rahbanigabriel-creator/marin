import { parsePaidSyncRangeInput } from "@/lib/connectors/paid-sync";
import { RequestBodyError, readBoundedJson } from "@/lib/security/request-body";

const MAX_SYNC_BODY_BYTES = 256;

export async function readSyncRequest(request: Request): Promise<{ range: { from: Date; to: Date }; automatic: boolean } | null> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return null;

  try {
    const body = await readBoundedJson<unknown>(request, MAX_SYNC_BODY_BYTES);
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const { mode, ...dates } = body as Record<string, unknown>;
    if (mode !== undefined && mode !== "automatic" && mode !== "manual") return null;
    const range = parsePaidSyncRangeInput(dates);
    return range ? { range, automatic: mode === "automatic" } : null;
  } catch (error) {
    if (error instanceof RequestBodyError && error.code === "payload_too_large") {
      throw error;
    }
    return null;
  }
}

export async function readSyncRange(request: Request): Promise<{ from: Date; to: Date } | null> {
  return (await readSyncRequest(request))?.range ?? null;
}
