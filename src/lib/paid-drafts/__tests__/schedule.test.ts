import assert from "node:assert/strict";
import test from "node:test";
import { assertPaidScheduleCurrent, resolveGeneratedPaidSchedule, suggestedPaidSchedule } from "../schedule";
import { PaidDraftValidationError } from "../validation";

test("default paid schedule starts tomorrow in the account timezone", () => {
  assert.deepEqual(suggestedPaidSchedule(new Date("2026-09-04T22:30:00Z"), "Europe/Madrid"), {
    startsDate: "2026-09-06", startsTime: "09:00", durationDays: 7,
  });
  assert.equal(suggestedPaidSchedule(new Date("2026-12-31T15:00:00Z"), "UTC").startsDate, "2027-01-01");
});

test("one week means seven calendar days at the same local time", () => {
  assert.deepEqual(resolveGeneratedPaidSchedule({ startsDate: "2026-09-05", startsTime: "09:00", durationDays: 7 }, "Europe/Madrid"), {
    startsAt: "2026-09-05T09:00:00+02:00", endsAt: "2026-09-12T09:00:00+02:00", timezone: "Europe/Madrid",
  });
});

test("campaign duration preserves wall clock across both DST changes", () => {
  const spring = resolveGeneratedPaidSchedule({ startsDate: "2026-03-28", startsTime: "09:00", durationDays: 7 }, "Europe/Madrid");
  assert.equal(spring.startsAt, "2026-03-28T09:00:00+01:00");
  assert.equal(spring.endsAt, "2026-04-04T09:00:00+02:00");
  const autumn = resolveGeneratedPaidSchedule({ startsDate: "2026-10-24", startsTime: "09:00", durationDays: 7 }, "Europe/Madrid");
  assert.equal(autumn.startsAt, "2026-10-24T09:00:00+02:00");
  assert.equal(autumn.endsAt, "2026-10-31T09:00:00+01:00");
});

test("invalid, overflowing, or invented local dates and durations are rejected", () => {
  const valid = { startsDate: "2026-09-05", startsTime: "09:00", durationDays: 7 };
  for (const value of [null, [], {}, { ...valid, durationDays: 0 }, { ...valid, durationDays: 366 },
    { ...valid, durationDays: 7.5 }, { ...valid, durationDays: "7" }, { ...valid, startsDate: "2026-02-30" },
    { ...valid, startsTime: "25:00" }, { ...valid, startsDate: "2026-03-29", startsTime: "02:30" },
    { ...valid, startsDate: "2026-03-22", startsTime: "02:30" }, { ...valid, endsAt: "invented" },
  ]) assert.throws(() => resolveGeneratedPaidSchedule(value, "Europe/Madrid"));
});

test("ready and create approvals require a future start, activation requires an unexpired end", () => {
  const schedule = resolveGeneratedPaidSchedule({ startsDate: "2026-09-05", startsTime: "09:00", durationDays: 7 }, "UTC");
  assert.doesNotThrow(() => assertPaidScheduleCurrent(schedule, new Date("2026-09-05T08:59:59Z")));
  for (const date of ["2026-09-05T09:00:00Z", "2026-09-06T09:00:00Z"]) {
    assert.throws(() => assertPaidScheduleCurrent(schedule, new Date(date)), (error: unknown) =>
      error instanceof PaidDraftValidationError && error.code === "schedule_in_past" && error.path === "schedule.startsAt");
  }
  assert.doesNotThrow(() => assertPaidScheduleCurrent(schedule, new Date("2026-09-06T09:00:00Z"), false));
  assert.throws(() => assertPaidScheduleCurrent(schedule, new Date("2026-09-12T09:00:00Z"), false));
});
