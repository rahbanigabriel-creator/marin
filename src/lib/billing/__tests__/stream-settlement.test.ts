import assert from "node:assert/strict";
import test from "node:test";

import {
  createUsageSettlementGate,
  UsageSettlementError,
} from "@/lib/billing/stream-settlement";

test("billable output waits for a durable commit", async () => {
  const order: string[] = [];
  let resolveCommit: ((value: boolean) => void) | undefined;
  const gate = createUsageSettlementGate({
    persisted: true,
    commit: () =>
      new Promise<boolean>((resolve) => {
        order.push("commit:start");
        resolveCommit = resolve;
      }),
  });

  const delivery = gate.emit(() => order.push("output"));
  await Promise.resolve();
  assert.deepEqual(order, ["commit:start"]);
  assert.equal(gate.state, "committing");

  resolveCommit?.(true);
  await delivery;
  assert.deepEqual(order, ["commit:start", "output"]);
  assert.equal(gate.state, "committed");
  assert.equal(gate.shouldRelease(), false);
});

test("a failed commit suppresses output and stays reconcilable", async () => {
  let delivered = false;
  const gate = createUsageSettlementGate({
    persisted: true,
    commit: async () => false,
  });

  await assert.rejects(
    gate.emit(() => {
      delivered = true;
    }),
    UsageSettlementError,
  );
  assert.equal(delivered, false);
  assert.equal(gate.state, "unsettled");
  assert.equal(gate.shouldRelease(), false);
});

test("only reservations that never produced billable output are releasable", async () => {
  let commits = 0;
  const reserved = createUsageSettlementGate({
    persisted: true,
    commit: async () => {
      commits += 1;
      return true;
    },
  });
  const unmetered = createUsageSettlementGate({
    persisted: false,
    commit: async () => {
      commits += 1;
      return true;
    },
  });

  assert.equal(reserved.shouldRelease(), true);
  await unmetered.emit(() => undefined);
  assert.equal(unmetered.shouldRelease(), false);
  assert.equal(commits, 0);
});
