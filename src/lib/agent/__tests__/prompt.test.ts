import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentPrompt } from "../prompt";

test("planning prompts carry an explicit timezone and Monday-start next week", () => {
  const { userContent } = buildAgentPrompt({
    question: "Plan next week's posts",
    persona: "founder",
    timeZone: "Europe/Madrid",
    now: new Date("2026-07-18T12:00:00.000Z"),
  });
  assert.match(userContent, /Today is Saturday, 18 July 2026 in Europe\/Madrid/);
  assert.match(userContent, /Monday, 20 July 2026 through Sunday, 26 July 2026/);
  assert.match(userContent, /Verify every weekday\/date pair/);
});
