import assert from "node:assert/strict";
import test from "node:test";

import { PLANS } from "../plans";

test("plans do not advertise report export entitlements without an export product", () => {
  for (const plan of Object.values(PLANS)) {
    assert.equal("canExportReports" in plan.entitlements, false);
    assert.equal("brandedReports" in plan.entitlements, false);
  }
});
