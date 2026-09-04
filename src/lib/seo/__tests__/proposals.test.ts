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

test("AI proposal parsing normalizes bounded text wrappers and text blocks", () => {
  assert.deepEqual(
    parseSeoProposalOutput(JSON.stringify({
      recommendedFix: { type: "text", text: " Replace the generic title with the app value proposition. " },
    })),
    { recommendedFix: "Replace the generic title with the app value proposition." },
  );
  assert.deepEqual(
    validateSeoProposalOutput({
      recommendedFix: {
        content: [
          { type: "text", text: "Draft the replacement." },
          { type: "text", text: "Review it before publishing." },
        ],
      },
    }),
    { recommendedFix: "Draft the replacement.\nReview it before publishing." },
  );
});

test("AI proposal parsing rejects extra claims and malformed output shapes", () => {
  for (const value of [
    { recommendedFix: "Valid", applied: true },
    { recommendedFix: "" },
    { recommendedFix: { text: "Valid", applied: true } },
    { recommendedFix: [{ type: "tool_use", text: "Not a text block" }] },
    { recommendedFix: Array.from({ length: 21 }, () => "Too many blocks") },
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
