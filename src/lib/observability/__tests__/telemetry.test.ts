import assert from "node:assert/strict";
import test from "node:test";

import { buildLlmGenerationTelemetry } from "@/lib/observability/telemetry";

test("LLM telemetry contains usage and cost but no customer content fields", () => {
  const telemetry = buildLlmGenerationTelemetry({
    tier: "medium",
    inputTokens: 2_000,
    outputTokens: 500,
  });

  assert.deepEqual(telemetry.usageDetails, {
    input: 2_000,
    output: 500,
    total: 2_500,
  });
  assert.deepEqual(telemetry.costDetails, {
    input: 0.006,
    output: 0.0075,
    total: 0.0135,
  });
  assert.equal(telemetry.metadata.contentCapture, "disabled");

  const serialized = JSON.stringify(telemetry).toLowerCase();
  for (const forbiddenKey of [
    '"input":"',
    '"output":"',
    "prompt",
    "completion",
    "messages",
    "question",
  ]) {
    assert.equal(serialized.includes(forbiddenKey), false);
  }
});

test("LLM telemetry clamps invalid negative token counts", () => {
  const telemetry = buildLlmGenerationTelemetry({
    tier: "low",
    inputTokens: -4,
    outputTokens: -2,
  });
  assert.deepEqual(telemetry.usageDetails, { input: 0, output: 0, total: 0 });
  assert.deepEqual(telemetry.costDetails, { input: 0, output: 0, total: 0 });
});
