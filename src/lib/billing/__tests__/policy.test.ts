import assert from "node:assert/strict";
import test from "node:test";

import { resolveBillingPolicy, utcCalendarMonth } from "../policy";

const NOW = new Date("2026-07-20T12:00:00.000Z");

test("Free usage follows a deterministic UTC calendar month", () => {
  const period = utcCalendarMonth(NOW);
  assert.equal(period.start.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(period.end.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(resolveBillingPolicy(null, NOW).planId, "free");
});

test("only a current active or trialing Solo period grants paid entitlements", () => {
  for (const status of ["active", "trialing"]) {
    const policy = resolveBillingPolicy(
      {
        plan: "solo",
        status,
        currentPeriodStart: new Date("2026-07-10T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-08-10T00:00:00.000Z"),
      },
      NOW,
    );
    assert.equal(policy.planId, "solo");
    assert.equal(policy.entitlements.canUseOpus, false);
    assert.equal(policy.entitlements.maxConnections, 4);
    assert.equal(policy.periodStart.toISOString(), "2026-07-01T00:00:00.000Z");
    assert.equal(policy.periodEnd.toISOString(), "2026-08-01T00:00:00.000Z");
  }
});

test("annual Solo subscriptions still receive a monthly UTC credit allowance", () => {
  const policy = resolveBillingPolicy(
    {
      plan: "solo",
      status: "active",
      currentPeriodStart: new Date("2026-01-15T12:00:00.000Z"),
      currentPeriodEnd: new Date("2027-01-15T12:00:00.000Z"),
    },
    NOW,
  );
  assert.equal(policy.planId, "solo");
  assert.equal(policy.periodStart.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(policy.periodEnd.toISOString(), "2026-08-01T00:00:00.000Z");
});

test("checkout-like, stale, canceled, and deferred rows fail closed to Free", () => {
  const cases = [
    { plan: "solo", status: "pending", start: "2026-07-10", end: "2026-08-10" },
    { plan: "solo", status: "canceled", start: "2026-07-10", end: "2026-08-10" },
    { plan: "solo", status: "active", start: "2026-06-01", end: "2026-07-01" },
    { plan: "business", status: "active", start: "2026-07-10", end: "2026-08-10" },
  ];

  for (const item of cases) {
    const policy = resolveBillingPolicy(
      {
        plan: item.plan,
        status: item.status,
        currentPeriodStart: new Date(`${item.start}T00:00:00.000Z`),
        currentPeriodEnd: new Date(`${item.end}T00:00:00.000Z`),
      },
      NOW,
    );
    assert.equal(policy.planId, "free");
    assert.equal(policy.entitlements.canUseOpus, false);
  }
});
