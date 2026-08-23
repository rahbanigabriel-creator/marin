export type LlmTelemetryTier = "low" | "medium" | "high";

const TIER_PRICE_PER_MTOK: Record<
  LlmTelemetryTier,
  { input: number; output: number }
> = {
  low: { input: 1, output: 5 },
  medium: { input: 3, output: 15 },
  high: { input: 5, output: 25 },
};

export function buildLlmGenerationTelemetry(input: {
  tier: LlmTelemetryTier;
  inputTokens: number;
  outputTokens: number;
}) {
  const inputTokens = Math.max(0, Math.trunc(input.inputTokens));
  const outputTokens = Math.max(0, Math.trunc(input.outputTokens));
  const price = TIER_PRICE_PER_MTOK[input.tier];
  const inputCost = (inputTokens / 1_000_000) * price.input;
  const outputCost = (outputTokens / 1_000_000) * price.output;

  return {
    usageDetails: {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens + outputTokens,
    },
    costDetails: {
      input: inputCost,
      output: outputCost,
      total: inputCost + outputCost,
    },
    metadata: {
      tier: input.tier,
      costCurrency: "USD",
      contentCapture: "disabled",
    },
  } as const;
}
