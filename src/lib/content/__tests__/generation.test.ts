import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFallbackWeeklyIdeas,
  buildNextPlanningMonth,
  buildNextPlanningWeek,
  contentPlanGenerationRequestHash,
  parseWeeklyIdeaOutput,
  validateWeeklyIdeas,
  type WeeklyIdeaContext,
} from "../generation";
import { parseProposalOutput, validateProposalFields } from "../proposals";

function context(now = new Date("2026-07-20T10:00:00.000Z")): WeeklyIdeaContext {
  return {
    brand: {
      id: "brand-1",
      name: "Marpin",
      summary: "A distribution operating system",
      audience: ["Solo software founders"],
      voice: ["Direct", "Practical"],
      offers: ["A marketing operating system"],
      proofPoints: [],
      timezone: "Europe/Madrid",
      locale: "en-GB",
    },
    week: buildNextPlanningWeek(now, "Europe/Madrid"),
    platforms: ["instagram", "reddit", "youtube"],
  };
}

test("next-week planning is Monday-to-Monday in the persisted timezone", () => {
  const week = buildNextPlanningWeek(
    new Date("2026-07-20T22:30:00.000Z"),
    "Europe/Madrid",
  );
  assert.equal(week.startKey, "2026-07-27");
  assert.equal(week.endKey, "2026-08-03");
  assert.equal(week.dates.length, 7);
  assert.equal(week.startDate.toISOString(), "2026-07-26T22:00:00.000Z");
  assert.equal(week.endDate.toISOString(), "2026-08-02T22:00:00.000Z");
});

test("planning bounds retain local midnight across a DST change", () => {
  const week = buildNextPlanningWeek(
    new Date("2026-10-18T12:00:00.000Z"),
    "Europe/Madrid",
  );
  assert.equal(week.startKey, "2026-10-19");
  assert.equal(week.endKey, "2026-10-26");
  assert.equal(week.startDate.toISOString(), "2026-10-18T22:00:00.000Z");
  assert.equal(week.endDate.toISOString(), "2026-10-25T23:00:00.000Z");
});

test("next-month planning covers every local calendar day", () => {
  const month = buildNextPlanningMonth(
    new Date("2026-07-20T22:30:00.000Z"),
    "Europe/Madrid",
  );
  assert.equal(month.period, "month");
  assert.equal(month.startKey, "2026-08-01");
  assert.equal(month.endKey, "2026-09-01");
  assert.equal(month.dates.length, 31);
  assert.equal(month.dates[0], "2026-08-01");
  assert.equal(month.dates.at(-1), "2026-08-31");
  assert.equal(month.startDate.toISOString(), "2026-07-31T22:00:00.000Z");
  assert.equal(month.endDate.toISOString(), "2026-08-31T22:00:00.000Z");
});

test("monthly fallback fills the complete plan with valid rotating destinations", () => {
  const value = context();
  value.week = buildNextPlanningMonth(
    new Date("2026-07-20T10:00:00.000Z"),
    "Europe/Madrid",
  );
  const ideas = buildFallbackWeeklyIdeas(value);
  assert.equal(ideas.length, 31);
  assert.deepEqual(ideas.map((idea) => idea.date), value.week.dates);
  assert.ok(ideas.every((idea) => /^\d{2}:\d{2}$/.test(idea.time)));
  assert.deepEqual(validateWeeklyIdeas(ideas, value), ideas);
});

test("generation replay identity binds the exact period and destination order", () => {
  const weekly = contentPlanGenerationRequestHash({
    brandId: "brand-1",
    platforms: ["instagram", "reddit"],
    period: "week",
  });
  assert.equal(
    weekly,
    contentPlanGenerationRequestHash({
      brandId: "brand-1",
      platforms: ["instagram", "reddit"],
      period: "week",
    }),
  );
  assert.notEqual(
    weekly,
    contentPlanGenerationRequestHash({
      brandId: "brand-1",
      platforms: ["instagram", "reddit"],
      period: "month",
    }),
  );
  assert.notEqual(
    weekly,
    contentPlanGenerationRequestHash({
      brandId: "brand-1",
      platforms: ["reddit", "instagram"],
      period: "week",
    }),
  );
});

test("grounded fallback creates one editable draft idea per day", () => {
  const value = context();
  const ideas = buildFallbackWeeklyIdeas(value);
  assert.equal(ideas.length, 7);
  assert.deepEqual(ideas.map((idea) => idea.date), value.week.dates);
  assert.deepEqual(ideas.slice(0, 3).map((idea) => idea.platform), [
    "instagram",
    "reddit",
    "youtube",
  ]);
  assert.ok(ideas.every((idea) => idea.title.includes("Marpin")));
  assert.ok(ideas.every((idea) => !/\d+%|customer said|guarantee/i.test(idea.copy)));
});

test("model JSON is accepted only when all seven destinations are bounded", () => {
  const value = context();
  const ideas = buildFallbackWeeklyIdeas(value);
  assert.deepEqual(
    parseWeeklyIdeaOutput(`\`\`\`json\n${JSON.stringify(ideas)}\n\`\`\``, value),
    ideas,
  );
  assert.throws(() => parseWeeklyIdeaOutput("not json", value), /invalid JSON/);
  assert.throws(
    () => validateWeeklyIdeas(ideas.map((idea, index) =>
      index === 1 ? { ...idea, date: ideas[0].date } : idea,
    ), value),
    /each planning day once/,
  );
  assert.throws(
    () => validateWeeklyIdeas(ideas.map((idea, index) =>
      index === 3 ? { ...idea, platform: "linkedin" } : idea,
    ), value),
    /destination is not allowed/,
  );
});

test("copy proposals accept only the bounded fields for their editor", () => {
  assert.deepEqual(
    parseProposalOutput(
      "master",
      '```json\n{"title":"A useful idea","objective":"Teach","brief":"Show the workflow","coreCopy":"Make distribution repeatable."}\n```',
    ),
    {
      title: "A useful idea",
      objective: "Teach",
      brief: "Show the workflow",
      coreCopy: "Make distribution repeatable.",
    },
  );
  assert.deepEqual(
    validateProposalFields("variant", {
      title: "A TikTok-native hook",
      body: "Build distribution while you build.",
      firstComment: "What is your distribution habit?",
    }),
    {
      title: "A TikTok-native hook",
      body: "Build distribution while you build.",
      firstComment: "What is your distribution habit?",
    },
  );
  assert.throws(
    () => validateProposalFields("variant", {
      title: "Unsafe expansion",
      body: "Copy",
      firstComment: "",
      publishNow: true,
    }),
    /outside the requested copy change/,
  );
});
