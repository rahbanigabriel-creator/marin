import assert from "node:assert/strict";
import test from "node:test";

import { RequestBodyError } from "@/lib/security/request-body";
import { readSelectedAccountId } from "./[platform]/select/_lib/request";

test("account selection accepts a normal URL-encoded form", async () => {
  const request = new Request("https://www.marpin.ai/api/connect/meta_ads/select", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ account_id: "act_123456789" }),
  });

  assert.equal(await readSelectedAccountId(request), "act_123456789");
});

test("account selection rejects a chunked form over its byte limit without Content-Length", async () => {
  const encoder = new TextEncoder();
  let index = 0;
  const chunks = ["account_id=act_", "9".repeat(300)];
  const request = new Request("https://www.marpin.ai/api/connect/meta_ads/select", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
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
  assert.equal(request.headers.has("content-length"), false);

  await assert.rejects(
    () => readSelectedAccountId(request),
    (error: unknown) =>
      error instanceof RequestBodyError
      && error.code === "payload_too_large"
      && error.status === 413,
  );
});
