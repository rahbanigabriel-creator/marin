import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentCalendarContext,
  resolvePlanningTimeZone,
  weekdayForIsoDate,
} from "../calendar";

test("next week is Monday through Sunday in the user's timezone", () => {
  const context = buildAgentCalendarContext(
    new Date("2026-07-18T12:00:00.000Z"),
    "Europe/Madrid",
  );
  assert.deepEqual(context, {
    timeZone: "Europe/Madrid",
    today: "Saturday, 18 July 2026",
    nextWeekStart: "Monday, 20 July 2026",
    nextWeekEnd: "Sunday, 26 July 2026",
  });
});

test("weekday validation catches the date pair that failed in production", () => {
  assert.equal(weekdayForIsoDate("2026-07-21"), "Tuesday");
  assert.equal(weekdayForIsoDate("2026-07-20"), "Monday");
});

test("invalid timezones fall back to UTC", () => {
  const context = buildAgentCalendarContext(new Date("2026-07-18T23:30:00.000Z"), "Mars/Olympus");
  assert.equal(context.timeZone, "UTC");
  assert.equal(context.today, "Saturday, 18 July 2026");
});

test("DST transitions do not shift the planning date", () => {
  const context = buildAgentCalendarContext(
    new Date("2026-03-29T00:30:00.000Z"),
    "Europe/Madrid",
  );
  assert.equal(context.today, "Sunday, 29 March 2026");
  assert.equal(context.nextWeekStart, "Monday, 30 March 2026");
});

test("saved brand timezone wins over workspace and browser timezone", () => {
  assert.equal(
    resolvePlanningTimeZone({
      brand: "Europe/Madrid",
      workspace: "America/New_York",
      browser: "Asia/Tokyo",
    }),
    "Europe/Madrid",
  );
});

test("invalid saved zones fall through to the next valid source", () => {
  assert.equal(
    resolvePlanningTimeZone({
      brand: "Mars/Olympus",
      workspace: "Europe/Paris",
      browser: "Asia/Tokyo",
    }),
    "Europe/Paris",
  );
});

test("saved workspace timezone wins when no valid brand timezone exists", () => {
  assert.equal(
    resolvePlanningTimeZone({ workspace: "America/New_York", browser: "Asia/Tokyo" }),
    "America/New_York",
  );
});

test("browser timezone is used only when saved defaults are unavailable", () => {
  assert.equal(resolvePlanningTimeZone({ browser: "Asia/Tokyo" }), "Asia/Tokyo");
});

test("UTC is the deterministic final fallback", () => {
  assert.equal(resolvePlanningTimeZone({}), "UTC");
  assert.equal(resolvePlanningTimeZone({ browser: "Mars/Olympus" }), "UTC");
});
