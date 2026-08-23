import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCalendarRange,
  parseContentItemCreateBody,
  parseContentItemPatchBody,
  parseContentPostCreateBody,
  parseContentPostPatchBody,
  parseExpectedVersionBody,
  parseGenerateContentImageBody,
  parseGenerateWeeklyPlanBody,
  parsePlanCreateBody,
  parsePlanPatchBody,
} from "../validation";

test("content image generation validates versioned, bounded creative input", () => {
  assert.deepEqual(
    parseGenerateContentImageBody({
      expectedVersion: 3,
      requestId: "content_image_12345",
      prompt: "A clean editorial product scene",
      aspectRatio: "4:5",
      altText: "Marpin campaign calendar",
    }),
    {
      expectedVersion: 3,
      requestId: "content_image_12345",
      prompt: "A clean editorial product scene",
      aspectRatio: "4:5",
      altText: "Marpin campaign calendar",
    },
  );
  assert.throws(
    () => parseGenerateContentImageBody({
      expectedVersion: 3,
      requestId: "content_image_12345",
      prompt: "Visual",
      aspectRatio: "2:1",
    }),
    /supported image aspect ratio/,
  );
});

test("weekly generation accepts a bounded idempotency key and organic destinations", () => {
  assert.deepEqual(
    parseGenerateWeeklyPlanBody({
      brandId: "brand-1",
      requestId: "weekly_plan_123456",
      platforms: ["instagram", "reddit", "instagram"],
      workspaceId: "spoofed",
      actorId: "spoofed",
    }),
    {
      brandId: "brand-1",
      requestId: "weekly_plan_123456",
      platforms: ["instagram", "reddit"],
      period: "week",
    },
  );
  assert.equal(
    parseGenerateWeeklyPlanBody({
      brandId: "brand-1",
      requestId: "monthly_plan_123456",
      platforms: ["instagram"],
      period: "month",
    }).period,
    "month",
  );
  assert.throws(
    () => parseGenerateWeeklyPlanBody({ brandId: "brand-1", requestId: "short", platforms: ["instagram"] }),
    /requestId is invalid/,
  );
  assert.throws(
    () => parseGenerateWeeklyPlanBody({ brandId: "brand-1", requestId: "weekly_plan_123456", platforms: ["linkedin"] }),
    /supported organic platforms/,
  );
  assert.throws(
    () => parseGenerateWeeklyPlanBody({
      brandId: "brand-1",
      requestId: "weekly_plan_123456",
      platforms: ["instagram"],
      period: "quarter",
    }),
    /weekly or monthly planning period/,
  );
});

test("calendar ranges require explicit-zone ISO instants and use a 93-day cap", () => {
  const range = parseCalendarRange("2026-07-20T00:00:00+02:00", "2026-07-27T00:00:00+02:00");
  assert.equal(range.start.toISOString(), "2026-07-19T22:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-07-26T22:00:00.000Z");
  assert.throws(
    () => parseCalendarRange("2026-07-20T00:00:00", "2026-07-27T00:00:00Z"),
    /explicit timezone/,
  );
  assert.throws(
    () => parseCalendarRange("2026-01-01T00:00:00Z", "2026-04-05T00:00:00Z"),
    /cannot exceed 93 days/,
  );
  assert.throws(
    () => parseCalendarRange("2026-07-27T00:00:00Z", "2026-07-20T00:00:00Z"),
    /end must be after start/,
  );
});

test("week plans are Monday-to-Monday local-midnight intervals", () => {
  const parsed = parsePlanCreateBody({
    brandId: "brand-1",
    name: "Launch week",
    objective: "Ship a coherent week",
    period: "week",
    timezone: "Europe/Madrid",
    startDate: "2026-10-19T00:00:00+02:00",
    endDate: "2026-10-26T00:00:00+01:00",
  });
  assert.equal(parsed.period, "week");
  assert.equal(parsed.endDate.getTime() - parsed.startDate.getTime(), 169 * 60 * 60 * 1_000);
  assert.throws(
    () =>
      parsePlanCreateBody({
        brandId: "brand-1",
        name: "Not Monday",
        period: "week",
        timezone: "Europe/Madrid",
        startDate: "2026-10-20T00:00:00+02:00",
        endDate: "2026-10-27T00:00:00+01:00",
      }),
    /Monday midnight/,
  );
});

test("month plans cover one complete local calendar month", () => {
  const parsed = parsePlanCreateBody({
    brandId: "brand-1",
    name: "October",
    period: "month",
    timezone: "Europe/Madrid",
    startDate: "2026-10-01T00:00:00+02:00",
    endDate: "2026-11-01T00:00:00+01:00",
  });
  assert.equal(parsed.period, "month");
  assert.throws(
    () =>
      parsePlanCreateBody({
        brandId: "brand-1",
        name: "Rolling month",
        period: "month",
        timezone: "Europe/Madrid",
        startDate: "2026-10-02T00:00:00+02:00",
        endDate: "2026-11-02T00:00:00+01:00",
      }),
    /complete local calendar month/,
  );
});

test("plan patches accept only versioned editable fields and discard actor context", () => {
  assert.deepEqual(parsePlanPatchBody({
    expectedVersion: 3,
    name: "  Refined plan  ",
    objective: null,
    status: "active",
    actorRole: "owner",
    actorId: "spoofed-user",
    workspaceId: "spoofed-workspace",
  }), {
    expectedVersion: 3,
    name: "Refined plan",
    objective: null,
    status: "active",
  });
  assert.deepEqual(
    parseExpectedVersionBody({ expectedVersion: 2, actorRole: "owner", workspaceId: "spoofed" }),
    { expectedVersion: 2 },
  );
  assert.throws(
    () => parsePlanPatchBody({ name: "Missing version" }),
    /expectedVersion must be a positive integer/,
  );
  assert.throws(
    () => parsePlanPatchBody({ expectedVersion: 1, status: "published" }),
    /Invalid plan status/,
  );
  assert.throws(
    () => parsePlanPatchBody({ expectedVersion: 1 }),
    /Provide name, objective, or status/,
  );
  assert.throws(
    () => parseExpectedVersionBody({ expectedVersion: 0 }),
    /expectedVersion must be a positive integer/,
  );
});

test("manual content item validation requires durable brand context and expectedVersion", () => {
  const create = parseContentItemCreateBody({
    planId: "plan-1",
    title: "  Founder lesson  ",
    status: "draft",
    coreCopy: "  A practical distribution lesson.  ",
  });
  assert.equal(create.title, "Founder lesson");
  assert.equal(create.coreCopy, "A practical distribution lesson.");
  assert.throws(() => parseContentItemCreateBody({ title: "No context" }), /brandId or planId/);
  assert.throws(
    () => parseContentItemCreateBody({
      brandId: "brand-1",
      title: "Bundled creation approval",
      status: "approved",
    }),
    /Create content first, then approve/,
  );

  const patch = parseContentItemPatchBody({ expectedVersion: 3, title: "Revision" });
  assert.equal(patch.expectedVersion, 3);
  const approval = parseContentItemPatchBody({
    expectedVersion: 4,
    status: "approved",
    approvalIntent: true,
  });
  assert.equal(approval.approvalIntent, true);
  assert.throws(
    () => parseContentItemPatchBody({ expectedVersion: 4, status: "approved" }),
    /explicit approval action/,
  );
  assert.throws(
    () => parseContentItemPatchBody({
      expectedVersion: 4,
      status: "approved",
      approvalIntent: true,
      title: "Bundled edit",
    }),
    /Save content changes before approving/,
  );
  assert.throws(
    () => parseContentItemPatchBody({ title: "Missing version" }),
    /expectedVersion must be a positive integer/,
  );
  assert.throws(
    () => parseContentItemPatchBody({ expectedVersion: 1, title: " ", brief: "Still invalid" }),
    /title is required/,
  );
  assert.throws(() => parseContentItemPatchBody({ expectedVersion: 1 }), /at least one/);
});

test("calendar post writes require an explicit instant and optimistic version", () => {
  const created = parseContentPostCreateBody({
    brandId: "brand-1",
    title: "Founder lesson",
    coreCopy: "A practical lesson.",
    platform: "instagram",
    format: "reel",
    status: "ready",
    scheduledAt: "2026-07-21T09:00:00+02:00",
  });
  assert.equal(created.status, "ready");
  assert.equal(created.scheduledAt.toISOString(), "2026-07-21T07:00:00.000Z");
  assert.throws(
    () => parseContentPostCreateBody({ ...created, scheduledAt: "2026-07-21T09:00:00" }),
    /explicit timezone/,
  );
  assert.throws(
    () => parseContentPostCreateBody({ ...created, platform: "tiktok", format: "pin" }),
    /format supported by that organic platform/,
  );
  assert.throws(
    () => parseContentPostCreateBody({ ...created, platform: "pinterest", format: "reel" }),
    /format supported by that organic platform/,
  );

  const patch = parseContentPostPatchBody({
    expectedVersion: 4,
    scheduledAt: "2026-07-22T09:00:00+02:00",
  });
  assert.equal(patch.expectedVersion, 4);
  assert.throws(
    () => parseContentPostPatchBody({ expectedVersion: 1, status: "scheduled" }),
    /draft or ready/,
  );
});
