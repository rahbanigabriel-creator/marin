import assert from "node:assert/strict";
import test from "node:test";

import { serializeWorkspaceExport } from "../workspace-export";

test("workspace exports serialize aggregate counters without losing precision", () => {
  const result = serializeWorkspaceExport({ clickCount: 9_007_199_254_740_993n });
  assert.match(result, /"clickCount": "9007199254740993"/);
});

