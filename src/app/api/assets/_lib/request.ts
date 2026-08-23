import { readBoundedFormData } from "@/lib/security/request-body";
import { MAX_SERVER_ASSET_BYTES } from "@/lib/storage/limits";

export const ASSET_MULTIPART_FRAMING_BYTES = 64 * 1024;
export const MAX_SERVER_ASSET_FORM_BYTES =
  MAX_SERVER_ASSET_BYTES + ASSET_MULTIPART_FRAMING_BYTES;

export function readAssetUploadForm(request: Request): Promise<FormData> {
  return readBoundedFormData(request, MAX_SERVER_ASSET_FORM_BYTES);
}
