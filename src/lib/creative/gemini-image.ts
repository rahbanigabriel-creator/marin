import type { ContentImageAspectRatio } from "@/lib/creative/image-provider";

export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";

export class GeminiImageGenerationError extends Error {
  constructor(
    readonly code: "not_configured" | "provider_rejected" | "invalid_output" | "timeout",
    message: string,
    readonly providerStatus?: number,
  ) {
    super(message);
    this.name = "GeminiImageGenerationError";
  }
}

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
  model: string;
}

interface GeminiInteractionResponse {
  output_image?: {
    data?: unknown;
    mime_type?: unknown;
  };
  steps?: unknown;
}

function outputImage(payload: GeminiInteractionResponse): {
  data?: unknown;
  mime_type?: unknown;
} | null {
  if (payload.output_image) return payload.output_image;
  if (!Array.isArray(payload.steps)) return null;
  for (let stepIndex = payload.steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
    const step = payload.steps[stepIndex];
    if (!step || typeof step !== "object" || Array.isArray(step)) continue;
    const record = step as Record<string, unknown>;
    if (record.type !== "model_output" || !Array.isArray(record.content)) continue;
    for (let contentIndex = record.content.length - 1; contentIndex >= 0; contentIndex -= 1) {
      const content = record.content[contentIndex];
      if (!content || typeof content !== "object" || Array.isArray(content)) continue;
      const block = content as Record<string, unknown>;
      if (block.type === "image") {
        return { data: block.data, mime_type: block.mime_type };
      }
    }
  }
  return null;
}

export function geminiImageModel(): string {
  return process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_GEMINI_IMAGE_MODEL;
}

export function isGeminiImageConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export async function generateGeminiImage(
  input: {
    prompt: string;
    aspectRatio: ContentImageAspectRatio;
    apiKey?: string;
    model?: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<GeneratedImage> {
  const apiKey = input.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiImageGenerationError(
      "not_configured",
      "Image generation is not configured yet.",
    );
  }
  const model = input.model?.trim() || geminiImageModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 90_000);
  try {
    const response = await (input.fetcher ?? fetch)(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          model,
          input: [{ type: "text", text: input.prompt }],
          response_format: {
            type: "image",
            mime_type: "image/png",
            aspect_ratio: input.aspectRatio,
            image_size: "1K",
          },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new GeminiImageGenerationError(
        "provider_rejected",
        "Gemini could not generate this visual. Try a different direction.",
        response.status,
      );
    }
    const payload = await response.json() as GeminiInteractionResponse;
    const image = outputImage(payload);
    const data = image?.data;
    const mimeType = image?.mime_type;
    if (
      typeof data !== "string" ||
      !data ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data) ||
      (mimeType !== undefined && typeof mimeType !== "string")
    ) {
      throw new GeminiImageGenerationError(
        "invalid_output",
        "Gemini returned no usable image.",
      );
    }
    const bytes = Buffer.from(data, "base64");
    if (!bytes.length) {
      throw new GeminiImageGenerationError(
        "invalid_output",
        "Gemini returned no usable image.",
      );
    }
    return {
      bytes,
      mimeType: typeof mimeType === "string" ? mimeType : "image/png",
      model,
    };
  } catch (error) {
    if (error instanceof GeminiImageGenerationError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GeminiImageGenerationError(
        "timeout",
        "Image generation timed out. Try again.",
      );
    }
    throw new GeminiImageGenerationError(
      "provider_rejected",
      "Gemini could not generate this visual. Try again.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
