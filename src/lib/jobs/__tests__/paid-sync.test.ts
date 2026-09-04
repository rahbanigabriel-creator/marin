import assert from "node:assert/strict";
import test from "node:test";

import {
  clampPaidBackfillDays,
  PAID_SYNC_JOB_TRIGGERS,
  runPaidSyncJob,
  type PaidSyncJobRunner,
} from "../paid-sync";

const RANGE = {
  from: new Date("2026-08-01T00:00:00.000Z"),
  to: new Date("2026-08-30T12:00:00.000Z"),
};

function successfulRunner(
  calls: Parameters<PaidSyncJobRunner>[0][],
): PaidSyncJobRunner {
  return async (input) => {
    calls.push(input);
    return {
      results: [
        { connectionId: "google-1", phases: { metrics: { complete: true, rows: 7 } } },
        { connectionId: "meta-1", phases: { metrics: { complete: true, rows: 5 } } },
      ],
    };
  };
}

test("scheduled paid sync uses the canonical runner with an explicit health trigger", async () => {
  const calls: Parameters<PaidSyncJobRunner>[0][] = [];
  const result = await runPaidSyncJob({
    workspaceId: "workspace-1",
    range: RANGE,
    trigger: PAID_SYNC_JOB_TRIGGERS.scheduled,
  }, { syncPaidWorkspace: successfulRunner(calls) });

  assert.deepEqual(calls, [{
    workspaceId: "workspace-1",
    range: RANGE,
    trigger: "scheduled",
    platforms: ["google_ads", "meta_ads"],
  }]);
  assert.deepEqual(result, { connections: 2, metrics: 12 });
});

test("post-connect paid sync stays scoped to the connected account platform", async () => {
  const calls: Parameters<PaidSyncJobRunner>[0][] = [];
  await runPaidSyncJob({
    workspaceId: "workspace-1",
    range: RANGE,
    trigger: PAID_SYNC_JOB_TRIGGERS.connected,
    platformFilter: "meta_ads",
  }, { syncPaidWorkspace: successfulRunner(calls) });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.trigger, "connected");
  assert.deepEqual(calls[0]?.platforms, ["meta_ads"]);
});

test("backfill paid sync uses its explicit trigger without widening the requested range", async () => {
  const calls: Parameters<PaidSyncJobRunner>[0][] = [];
  await runPaidSyncJob({
    workspaceId: "workspace-1",
    range: RANGE,
    trigger: PAID_SYNC_JOB_TRIGGERS.backfill,
    platformFilter: "google_ads",
  }, { syncPaidWorkspace: successfulRunner(calls) });

  assert.equal(calls.length, 1, "one bounded job batch must not create extra provider fan-out");
  assert.equal(calls[0]?.trigger, "backfill");
  assert.deepEqual(calls[0]?.range, RANGE);
  assert.deepEqual(calls[0]?.platforms, ["google_ads"]);
});

test("backfill depth is finite, integer, and capped before provider fan-out", () => {
  assert.equal(clampPaidBackfillDays(undefined, 365), 365);
  assert.equal(clampPaidBackfillDays(Number.NaN, 365), 365);
  assert.equal(clampPaidBackfillDays(Number.POSITIVE_INFINITY, 365), 365);
  assert.equal(clampPaidBackfillDays(900, 365), 365);
  assert.equal(clampPaidBackfillDays(14.9, 365), 14);
  assert.equal(clampPaidBackfillDays(-2, 365), 1);
  assert.throws(() => clampPaidBackfillDays(30, 0), RangeError);
});

test("incomplete metric snapshots are not reported as written", async () => {
  const result = await runPaidSyncJob({
    workspaceId: "workspace-1",
    range: RANGE,
    trigger: PAID_SYNC_JOB_TRIGGERS.scheduled,
  }, {
    syncPaidWorkspace: async () => ({
      results: [
        { connectionId: "google-1", phases: { metrics: { complete: false, rows: 9 } } },
      ],
    }),
  });

  assert.deepEqual(result, { connections: 1, metrics: 0 });
});

test("non-paid connection events never invoke the paid sync runner", async () => {
  let calls = 0;
  const result = await runPaidSyncJob({
    workspaceId: "workspace-1",
    range: RANGE,
    trigger: PAID_SYNC_JOB_TRIGGERS.connected,
    platformFilter: "ga4",
  }, {
    syncPaidWorkspace: async () => {
      calls += 1;
      return { results: [] };
    },
  });

  assert.equal(calls, 0);
  assert.deepEqual(result, { connections: 0, metrics: 0 });
});
