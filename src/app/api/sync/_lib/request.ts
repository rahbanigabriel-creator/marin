import { parsePaidSyncRangeInput } from "@/lib/connectors/paid-sync";
import { RequestBodyError, readBoundedJson } from "@/lib/security/request-body";

const MAX_SYNC_BODY_BYTES = 256;

export async function readSyncRange(request: Request): Promise<{ from: Date; to: Date } | null> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return null;

  try {
    return parsePaidSyncRangeInput(
      await readBoundedJson<unknown>(request, MAX_SYNC_BODY_BYTES),
    );
  } catch (error) {
    if (error instanceof RequestBodyError && error.code === "payload_too_large") {
      throw error;
    }
    return null;
  }
}
