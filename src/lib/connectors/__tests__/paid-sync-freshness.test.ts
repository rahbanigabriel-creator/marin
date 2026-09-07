import assert from "node:assert/strict";
import test from "node:test";
import { paidAutoSyncSkipReason } from "../paid-sync-freshness";

const now = new Date("2026-09-07T12:00:00Z");
const range = { from: new Date("2026-09-01"), to: new Date("2026-09-07") };
const successful = {
  status: "succeeded", startedAt: new Date(now.getTime() - 60_000), completedAt: new Date(now.getTime() - 50_000),
  requestedFrom: range.from, requestedTo: range.to,
  metricsStatus: "succeeded", campaignsStatus: "succeeded", adsStatus: "succeeded",
};

test("automatic sync reuses recent complete coverage, including empty successful snapshots", () => {
  assert.equal(paidAutoSyncSkipReason([successful], range, now), "fresh");
  assert.equal(paidAutoSyncSkipReason([successful], { ...range, from: new Date("2026-09-03") }, now), "fresh");
  assert.equal(paidAutoSyncSkipReason([], range, now), null);
  assert.equal(paidAutoSyncSkipReason([successful], range, new Date(now.getTime() + 5 * 60_000)), null);
});

test("new ranges and incomplete phases are never declared fresh", () => {
  assert.equal(paidAutoSyncSkipReason([successful], { ...range, from: new Date("2026-08-01") }, now), null);
  assert.equal(paidAutoSyncSkipReason([{ ...successful, adsStatus: "skipped" }], range, now), null);
  assert.equal(paidAutoSyncSkipReason([{ ...successful, requestedTo: new Date("2026-09-06") }], range, now), null);
});

test("automatic sync backs off failures, partial/cancelled runs, and rapid range changes", () => {
  for (const status of ["failed", "partial", "cancelled", "running"]) {
    assert.equal(paidAutoSyncSkipReason([{ ...successful, status }], range, now), "cooldown");
  }
  assert.equal(paidAutoSyncSkipReason([{ ...successful, completedAt: new Date(now.getTime() - 1000) }], { ...range, from: new Date("2026-08-01") }, now), "cooldown");
  assert.equal(paidAutoSyncSkipReason([{ ...successful, status: "failed", completedAt: null }], range, now), "cooldown");
});

test("a newer failed run cannot be hidden behind an older successful snapshot", () => {
  assert.equal(paidAutoSyncSkipReason([successful, { ...successful, status: "failed", startedAt: now, completedAt: now }], range, now), "cooldown");
});

test("abandoned jobs recovered in the claim transaction do not cause a permanent cooldown", () => {
  assert.equal(paidAutoSyncSkipReason([{ ...successful, status: "failed", errorCode: "sync_abandoned", completedAt: now }], range, now), null);
});
