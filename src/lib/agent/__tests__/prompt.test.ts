import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentPrompt } from "../prompt";

test("paid chat stays in launch scope and cannot claim execution", () => {
  const { system } = buildAgentPrompt({ question: "Maintain ROAS below 2", persona: "founder", mode: "paid" });
  assert.match(system, /PAID WORKSPACE CONTRACT/);
  assert.match(system, /ROAS is return divided by spend: higher is better/);
  assert.match(system, /clarify whether they mean alert below 2 or maintain at least 2/);
  assert.match(system, /not saved campaign drafts, provider writes, or scheduled agents/);
  assert.match(system, /Do not direct users to hidden Organic, SEO/);
});

test("paid chat does not inherit an unrelated workspace website audit", () => {
  const brand = { id: "brand_old", name: "Unrelated business", websiteUrl: "https://unrelated.example", summary: "Unrelated audit summary", audience: [], voice: [], offers: [], competitors: [], proofPoints: [], locale: "en", timezone: "UTC", currency: "EUR", contextVersion: 1 };
  const paid = buildAgentPrompt({ question: "Review my ad accounts", persona: "founder", mode: "paid", brand });
  assert.doesNotMatch(paid.userContent, /Unrelated business|unrelated\.example|VERIFIED AUDIT CONTEXT/);
  assert.match(paid.system, /Ground campaign identity in connected account evidence/);
  const organic = buildAgentPrompt({ question: "Review this website", persona: "founder", mode: "organic", brand });
  assert.match(organic.userContent, /Unrelated business/);
});

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
