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

test("live performance prompts require a grounded account read", () => {
  const { userContent } = buildAgentPrompt({
    question: "Monitor my connected Meta account",
    persona: "founder",
    dataMode: "live",
    metricsWindowDays: 90,
  });
  assert.match(userContent, /verified provider observations/);
  assert.match(userContent, /requested 90-day window/);
  assert.match(userContent, /call get_account_metrics before answering/);
  assert.match(userContent, /Never tell this user to connect the account/);
});

test("an empty evidence window never proves that OAuth is disconnected", () => {
  const { userContent } = buildAgentPrompt({
    question: "Check my connected account",
    persona: "founder",
    dataMode: "empty",
    metricsWindowDays: 30,
  });
  assert.match(userContent, /does not prove that OAuth is disconnected/);
  assert.match(userContent, /suggest a fresh sync/);
  assert.match(userContent, /do not falsely tell them to connect it again/);
});
