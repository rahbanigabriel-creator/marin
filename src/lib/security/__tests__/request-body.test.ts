import assert from "node:assert/strict";
import test from "node:test";

import {
  RequestBodyError,
  readBoundedBody,
  readBoundedFormData,
  readBoundedJson,
  readBoundedText,
  requestBodyErrorResponse,
} from "@/lib/security/request-body";

test("parses JSON at the byte limit", async () => {
  const body = '{"ok":true}';
  const request = new Request("https://www.marpin.ai/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(body.length) },
    body,
  });

  assert.deepEqual(await readBoundedJson(request, body.length), { ok: true });
});

test("rejects an oversized declared body before reading it", async () => {
  const request = new Request("https://www.marpin.ai/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "1000" },
    body: "{}",
  });

  await assert.rejects(
    () => readBoundedJson(request, 32),
    (error: unknown) =>
      error instanceof RequestBodyError &&
      error.code === "payload_too_large" &&
      error.status === 413,
  );
});

test("rejects a chunked body once the streamed bytes cross the limit", async () => {
  let reads = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads += 1;
      controller.enqueue(new TextEncoder().encode(reads === 1 ? "1234" : "5678"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://www.marpin.ai/api/test", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  await assert.rejects(
    () => readBoundedBody(request, 7),
    (error: unknown) =>
      error instanceof RequestBodyError && error.code === "payload_too_large",
  );
  await Promise.resolve();
  assert.equal(reads, 2);
  assert.equal(cancelled, true);
});

test("parses bounded URL-encoded and multipart form bodies", async () => {
  const encoded = new Request("https://www.marpin.ai/api/test", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "account_id=act_123&label=Primary+account",
  });
  const encodedForm = await readBoundedFormData(encoded, 128);
  assert.equal(encodedForm.get("account_id"), "act_123");
  assert.equal(encodedForm.get("label"), "Primary account");

  const multipartBody = new FormData();
  multipartBody.set("account_id", "act_456");
  const multipart = new Request("https://www.marpin.ai/api/test", {
    method: "POST",
    body: multipartBody,
  });
  const multipartForm = await readBoundedFormData(multipart, 512);
  assert.equal(multipartForm.get("account_id"), "act_456");
});

test("rejects malformed JSON, non-JSON media, compression, and invalid UTF-8", async () => {
  await assert.rejects(
    () => readBoundedJson(new Request("https://www.marpin.ai/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })),
    (error: unknown) => error instanceof RequestBodyError && error.code === "invalid_body",
  );
  await assert.rejects(
    () => readBoundedJson(new Request("https://www.marpin.ai/api/test", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    })),
    (error: unknown) =>
      error instanceof RequestBodyError && error.code === "unsupported_media_type",
  );
  await assert.rejects(
    () => readBoundedText(new Request("https://www.marpin.ai/api/test", {
      method: "POST",
      headers: { "content-encoding": "gzip" },
      body: "compressed",
    }), 32),
    (error: unknown) =>
      error instanceof RequestBodyError && error.code === "unsupported_content_encoding",
  );
  await assert.rejects(
    () => readBoundedText(new Request("https://www.marpin.ai/api/test", {
      method: "POST",
      body: new Uint8Array([0xff]),
    }), 32),
    (error: unknown) => error instanceof RequestBodyError && error.code === "invalid_body",
  );
});

test("maps request body failures to stable no-store responses", async () => {
  const response = requestBodyErrorResponse(
    new RequestBodyError("payload_too_large", "Request body is too large", 413),
  );
  assert.ok(response);
  assert.equal(response.status, 413);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "payload_too_large",
    code: "payload_too_large",
    message: "Request body is too large",
  });
  assert.equal(requestBodyErrorResponse(new Error("other")), null);
});
