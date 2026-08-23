import assert from "node:assert/strict";
import test from "node:test";

import { createRequestGate } from "@/lib/streaming/request-gate";

test("starting a retry makes every event from the previous stream stale", () => {
  const gate = createRequestGate();
  const first = gate.begin();
  const retry = gate.begin();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(retry), true);
});

test("stopping a request invalidates late frames before a retry starts", () => {
  const gate = createRequestGate();
  const request = gate.begin();
  gate.invalidate(request);
  assert.equal(gate.isCurrent(request), false);
});
