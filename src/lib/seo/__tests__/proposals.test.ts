import assert from "node:assert/strict";
import test from "node:test";

import { SeoValidationError } from "../errors";
import {
  parseSeoProposalOutput,
  validateSeoProposalOutput,
} from "../proposals";

test("AI proposal parsing accepts exactly one bounded recommended fix", () => {
  assert.deepEqual(
    parseSeoProposalOutput('```json\n{"recommendedFix":" Add one descriptive title. "}\n```'),
    { recommendedFix: "Add one descriptive title." },
  );
  assert.deepEqual(
    validateSeoProposalOutput({ recommendedFix: "Review, then apply manually." }),
    { recommendedFix: "Review, then apply manually." },
  );
});

test("AI proposal parsing rejects extra claims and malformed output shapes", () => {
  for (const value of [
    { recommendedFix: "Valid", applied: true },
    { recommendedFix: "" },
    { fix: "Wrong field" },
    ["Wrong shape"],
  ]) {
    assert.throws(
      () => validateSeoProposalOutput(value),
      (error: unknown) => error instanceof SeoValidationError && error.code === "invalid_ai_output",
    );
  }
  assert.throws(
    () => parseSeoProposalOutput("not-json"),
    (error: unknown) => error instanceof SeoValidationError && error.code === "invalid_ai_output",
  );
});
