import {
  GeminiImageGenerationError,
  generateGeminiImage,
  geminiImageModel,
  isGeminiImageConfigured,
} from "@/lib/creative/gemini-image";

export const IMAGE_GENERATION_CREDITS = 4;
export const CONTENT_IMAGE_ASPECT_RATIOS = ["1:1", "4:5", "16:9", "9:16"] as const;
export type ContentImageAspectRatio = (typeof CONTENT_IMAGE_ASPECT_RATIOS)[number];

export type ImageGenerationErrorCode =
  | "not_configured"
  | "provider_rejected"
  | "invalid_output"
  | "timeout";

export class ImageGenerationError extends Error {
  constructor(
    readonly code: ImageGenerationErrorCode,
    message: string,
    readonly providerStatus?: number,
  ) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

export interface GeneratedContentImage {
  bytes: Buffer;
  mimeType: string;
  provider: string;
  model: string;
}

export interface ImageGenerationProvider {
  id: string;
  isConfigured(): boolean;
  model(): string;
  generate(input: {
    prompt: string;
    aspectRatio: ContentImageAspectRatio;
    model: string;
  }): Promise<Omit<GeneratedContentImage, "provider">>;
}

const geminiProvider: ImageGenerationProvider = {
  id: "gemini",
  isConfigured: isGeminiImageConfigured,
  model: geminiImageModel,
  async generate(input) {
    return generateGeminiImage(input);
  },
};

const PROVIDERS: Record<string, ImageGenerationProvider> = {
  gemini: geminiProvider,
};

export function configuredImageProvider(): ImageGenerationProvider | null {
  const providerId = process.env.IMAGE_GENERATION_PROVIDER?.trim().toLowerCase() || "gemini";
  return PROVIDERS[providerId] ?? null;
}

export function isImageGenerationConfigured(): boolean {
  return Boolean(configuredImageProvider()?.isConfigured());
}

export function imageGenerationModel(): string {
  const provider = configuredImageProvider();
  if (!provider) {
    throw new ImageGenerationError("not_configured", "Image generation is not configured yet.");
  }
  return provider.model();
}

function providerFailure(error: GeminiImageGenerationError): ImageGenerationError {
  const message = error.code === "not_configured"
    ? "Image generation is not configured yet."
    : error.code === "invalid_output"
      ? "The image provider returned no usable image."
      : error.code === "timeout"
        ? "Image generation timed out. Try again."
        : "The image provider could not generate this visual. Try a different direction.";
  return new ImageGenerationError(error.code, message, error.providerStatus);
}

export async function generateContentImage(input: {
  prompt: string;
  aspectRatio: ContentImageAspectRatio;
  model?: string;
}): Promise<GeneratedContentImage> {
  const provider = configuredImageProvider();
  if (!provider || !provider.isConfigured()) {
    throw new ImageGenerationError("not_configured", "Image generation is not configured yet.");
  }
  try {
    const generated = await provider.generate({
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      model: input.model?.trim() || provider.model(),
    });
    return { ...generated, provider: provider.id };
  } catch (error) {
    if (error instanceof ImageGenerationError) throw error;
    if (error instanceof GeminiImageGenerationError) throw providerFailure(error);
    throw new ImageGenerationError(
      "provider_rejected",
      "The image provider could not generate this visual. Try again.",
    );
  }
}
