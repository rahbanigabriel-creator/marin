import assert from "node:assert/strict";
import test from "node:test";

import { RequestBodyError } from "@/lib/security/request-body";
import { readSyncRange } from "./_lib/request";

function chunkedRequest(chunks: string[], contentType: string): Request {
  const encoder = new TextEncoder();
  let index = 0;
  return new Request("https://www.marpin.ai/api/sync", {
    method: "POST",
    headers: { "content-type": contentType },
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index++];
        if (chunk === undefined) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunk));
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

test("sync accepts a normal valid JSON range", async () => {
  const request = new Request("https://www.marpin.ai/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: "2026-08-01", to: "2026-08-21" }),
  });

  const range = await readSyncRange(request);
  assert.equal(range?.from.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(range?.to.toISOString(), "2026-08-21T00:00:00.000Z");
});

test("sync rejects a chunked body over its byte limit without Content-Length", async () => {
  const request = chunkedRequest(
    [JSON.stringify({ from: "2026-08-01", to: "2026-08-21", padding: "x".repeat(240) })],
    "application/json",
  );
  assert.equal(request.headers.has("content-length"), false);

  await assert.rejects(
    () => readSyncRange(request),
    (error: unknown) =>
      error instanceof RequestBodyError
      && error.code === "payload_too_large"
      && error.status === 413,
  );
});
