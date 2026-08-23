import assert from "node:assert/strict";
import test from "node:test";

import { applyLaunchFeatureGates, LAUNCH_FEATURES } from "../features";

test("Extra responses remain disabled throughout the launch contract", () => {
  assert.equal(LAUNCH_FEATURES.opusResponses, false);
  assert.deepEqual(applyLaunchFeatureGates({ canUseOpus: true, maxSeats: 1 }), {
    canUseOpus: false,
    maxSeats: 1,
  });
});

test("launch gates never grant a plan entitlement that was already denied", () => {
  assert.equal(applyLaunchFeatureGates({ canUseOpus: false }).canUseOpus, false);
});
