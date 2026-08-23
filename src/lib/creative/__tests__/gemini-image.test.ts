import assert from "node:assert/strict";
import test from "node:test";

import {
  GeminiImageGenerationError,
  generateGeminiImage,
} from "../gemini-image";
import {
  configuredImageProvider,
  generateContentImage,
  ImageGenerationError,
} from "../image-provider";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("Gemini image generation uses the Interactions API and returns decoded private bytes", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const result = await generateGeminiImage({
    prompt: "A clear editorial product visual",
    aspectRatio: "4:5",
    apiKey: "test-key",
    model: "gemini-test-image",
    fetcher: (async (url, init) => {
      assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/interactions");
      assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "test-key");
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "interaction-1",
        status: "completed",
        steps: [{
          type: "model_output",
          content: [
            { type: "text", text: "Here is the visual." },
            { type: "image", data: PNG_BASE64, mime_type: "image/png" },
          ],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  });

  assert.equal(result.model, "gemini-test-image");
  assert.equal(result.mimeType, "image/png");
  assert.ok(result.bytes.length > 0);
  assert.deepEqual(requestBody, {
    model: "gemini-test-image",
    input: [{ type: "text", text: "A clear editorial product visual" }],
    response_format: {
      type: "image",
      mime_type: "image/png",
      aspect_ratio: "4:5",
      image_size: "1K",
    },
  });
});

test("Gemini image generation fails honestly when credentials or output are missing", async () => {
  const previous = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(
      () => generateGeminiImage({ prompt: "Visual", aspectRatio: "1:1" }),
      (error: unknown) =>
        error instanceof GeminiImageGenerationError && error.code === "not_configured",
    );
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }

  await assert.rejects(
    () => generateGeminiImage({
      prompt: "Visual",
      aspectRatio: "1:1",
      apiKey: "test-key",
      fetcher: (async () => new Response(JSON.stringify({ output_image: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof GeminiImageGenerationError && error.code === "invalid_output",
  );
});

test("Gemini provider errors and timeouts use stable sanitized failures", async () => {
  await assert.rejects(
    () => generateGeminiImage({
      prompt: "Visual",
      aspectRatio: "16:9",
      apiKey: "test-key",
      fetcher: (async () => new Response("secret provider body", { status: 429 })) as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof GeminiImageGenerationError &&
      error.code === "provider_rejected" &&
      error.providerStatus === 429 &&
      !error.message.includes("secret provider body"),
  );

  await assert.rejects(
    () => generateGeminiImage({
      prompt: "Visual",
      aspectRatio: "9:16",
      apiKey: "test-key",
      timeoutMs: 5,
      fetcher: ((_, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      })) as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof GeminiImageGenerationError && error.code === "timeout",
  );
});

test("the product-facing image facade fails generically when no adapter is selected", async () => {
  const previous = process.env.IMAGE_GENERATION_PROVIDER;
  process.env.IMAGE_GENERATION_PROVIDER = "not-installed";
  try {
    assert.equal(configuredImageProvider(), null);
    await assert.rejects(
      () => generateContentImage({ prompt: "Visual", aspectRatio: "1:1" }),
      (error: unknown) =>
        error instanceof ImageGenerationError &&
        error.code === "not_configured" &&
        !/gemini/i.test(error.message),
    );
  } finally {
    if (previous === undefined) delete process.env.IMAGE_GENERATION_PROVIDER;
    else process.env.IMAGE_GENERATION_PROVIDER = previous;
  }
});
