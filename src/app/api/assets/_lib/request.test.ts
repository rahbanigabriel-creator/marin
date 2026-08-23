import assert from "node:assert/strict";
import test from "node:test";

import {
  RequestBodyError,
  requestBodyErrorResponse,
} from "@/lib/security/request-body";
import { MAX_SERVER_ASSET_BYTES } from "@/lib/storage/limits";

import {
  ASSET_MULTIPART_FRAMING_BYTES,
  MAX_SERVER_ASSET_FORM_BYTES,
  readAssetUploadForm,
} from "./request";

test("asset upload parses a bounded multipart file", async () => {
  const input = new FormData();
  input.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "image.png", {
    type: "image/png",
  }));
  const request = new Request("https://www.marpin.ai/api/assets", {
    method: "POST",
    body: input,
  });

  const form = await readAssetUploadForm(request);
  const file = form.get("file");
  assert.ok(file instanceof File);
  assert.equal(file.name, "image.png");
  assert.equal(file.type, "image/png");
  assert.equal(file.size, 4);
});

test("asset upload rejects a chunked over-limit body without Content-Length", async () => {
  const chunks = [
    new Uint8Array(MAX_SERVER_ASSET_BYTES),
    new Uint8Array(ASSET_MULTIPART_FRAMING_BYTES + 1),
  ];
  let reads = 0;
  let cancelled = false;
  const request = new Request("https://www.marpin.ai/api/assets", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=marpin-boundary" },
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[reads];
        reads += 1;
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  assert.equal(request.headers.has("content-length"), false);

  let failure: unknown;
  try {
    await readAssetUploadForm(request);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof RequestBodyError);
  assert.equal(failure.code, "payload_too_large");
  assert.equal(failure.status, 413);
  assert.equal(reads, 2);
  await Promise.resolve();
  assert.equal(cancelled, true);

  const response = requestBodyErrorResponse(failure);
  assert.ok(response);
  assert.equal(response.status, 413);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "payload_too_large",
    code: "payload_too_large",
    message: "Request body is too large",
  });
  assert.equal(
    MAX_SERVER_ASSET_FORM_BYTES,
    MAX_SERVER_ASSET_BYTES + 64 * 1024,
  );
  assert.ok(MAX_SERVER_ASSET_FORM_BYTES < 5 * 1024 * 1024);
});
