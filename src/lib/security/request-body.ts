export const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;
export const STRIPE_WEBHOOK_BODY_LIMIT_BYTES = 1024 * 1024;

export type RequestBodyErrorCode =
  | "invalid_body"
  | "payload_too_large"
  | "unsupported_media_type"
  | "unsupported_content_encoding";

export class RequestBodyError extends Error {
  readonly code: RequestBodyErrorCode;
  readonly status: 400 | 413 | 415;

  constructor(code: RequestBodyErrorCode, message: string, status: 400 | 413 | 415) {
    super(message);
    this.name = "RequestBodyError";
    this.code = code;
    this.status = status;
  }
}

function assertLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 5 * 1024 * 1024) {
    throw new Error("Request body limit must be between 1 byte and 5 MiB");
  }
}

function declaredLength(request: Request, maxBytes: number): number | null {
  const raw = request.headers.get("content-length");
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) {
    throw new RequestBodyError("invalid_body", "Content-Length is invalid", 400);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new RequestBodyError("invalid_body", "Content-Length is invalid", 400);
  }
  if (value > maxBytes) {
    throw new RequestBodyError("payload_too_large", "Request body is too large", 413);
  }
  return value;
}

function assertIdentityEncoding(request: Request): void {
  const encoding = request.headers.get("content-encoding")?.trim().toLowerCase();
  if (encoding && encoding !== "identity") {
    throw new RequestBodyError(
      "unsupported_content_encoding",
      "Compressed request bodies are not accepted",
      415,
    );
  }
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel("request body reading stopped").catch(() => undefined);
  } catch {
    // A broken stream must not replace the stable request-body failure.
  }
}

export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  assertLimit(maxBytes);
  const expectedLength = declaredLength(request, maxBytes);
  assertIdentityEncoding(request);

  if (!request.body) {
    if (expectedLength !== null && expectedLength !== 0) {
      throw new RequestBodyError(
        "invalid_body",
        "Request body length does not match Content-Length",
        400,
      );
    }
    return new Uint8Array();
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    throw new RequestBodyError("invalid_body", "Request body could not be read", 400);
  }

  const chunks: Uint8Array[] = [];
  let length = 0;
  let shouldCancel = false;

  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch {
        shouldCancel = true;
        throw new RequestBodyError("invalid_body", "Request body could not be read", 400);
      }

      const { done, value } = result;
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        shouldCancel = true;
        throw new RequestBodyError("payload_too_large", "Request body is too large", 413);
      }
      chunks.push(value);
    }
  } finally {
    if (shouldCancel) cancelReader(reader);
    reader.releaseLock();
  }

  if (expectedLength !== null && expectedLength !== length) {
    throw new RequestBodyError("invalid_body", "Request body length does not match Content-Length", 400);
  }
  return concat(chunks, length);
}

export async function readBoundedText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const bytes = await readBoundedBody(request, maxBytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestBodyError("invalid_body", "Request body must be valid UTF-8", 400);
  }
}

export async function readBoundedJson<T = unknown>(
  request: Request,
  maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES,
): Promise<T> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType && mediaType !== "application/json" && !mediaType.endsWith("+json")) {
    throw new RequestBodyError(
      "unsupported_media_type",
      "Content-Type must be application/json",
      415,
    );
  }

  const body = await readBoundedText(request, maxBytes);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new RequestBodyError("invalid_body", "A valid JSON body is required", 400);
  }
}

export async function readBoundedFormData(
  request: Request,
  maxBytes: number,
): Promise<FormData> {
  const contentType = request.headers.get("content-type")?.trim();
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (
    !contentType
    || (mediaType !== "application/x-www-form-urlencoded" && mediaType !== "multipart/form-data")
  ) {
    throw new RequestBodyError(
      "unsupported_media_type",
      "Content-Type must be form encoded",
      415,
    );
  }

  const bytes = await readBoundedBody(request, maxBytes);
  const boundedRequest = new Request("https://www.marpin.ai/api/form-parser", {
    method: "POST",
    headers: { "content-type": contentType },
    body: bytes,
  });

  try {
    return await boundedRequest.formData();
  } catch {
    throw new RequestBodyError("invalid_body", "A valid form body is required", 400);
  }
}

export function requestBodyErrorResponse(error: unknown): Response | null {
  if (!(error instanceof RequestBodyError)) return null;
  return Response.json(
    { error: error.code, code: error.code, message: error.message },
    { status: error.status, headers: { "Cache-Control": "no-store" } },
  );
}
