import {
  RequestBodyError,
  readBoundedFormData,
} from "@/lib/security/request-body";

const MAX_ACCOUNT_SELECTION_BODY_BYTES = 256;

export async function readSelectedAccountId(request: Request): Promise<string | null> {
  try {
    const form = await readBoundedFormData(request, MAX_ACCOUNT_SELECTION_BODY_BYTES);
    const selectedId = form.get("account_id");
    return typeof selectedId === "string" && selectedId.length > 0 ? selectedId : null;
  } catch (error) {
    if (error instanceof RequestBodyError && error.code === "payload_too_large") {
      throw error;
    }
    return null;
  }
}
