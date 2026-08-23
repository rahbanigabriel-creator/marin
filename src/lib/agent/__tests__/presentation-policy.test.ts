import assert from "node:assert/strict";
import test from "node:test";

import { selectAutomaticPresentation } from "../presentation-policy";

const sample = {
  artifacts: [{ kind: "brief" as const, data: { title: "Sample", sections: [] } }],
  chips: [{ label: "ROAS 4x", tone: "good" as const }],
  closing: { split: "Sample", thread: "Sample" },
};

test("live connected data never injects unrelated metric presentation", () => {
  const result = selectAutomaticPresentation("live", sample);
  assert.deepEqual(result, { artifacts: [], chips: [], closing: { split: "", thread: "" } });
});

test("empty workspaces never inject a canned presentation", () => {
  const result = selectAutomaticPresentation("empty", sample);
  assert.equal(result.artifacts.length, 0);
  assert.equal(result.chips.length, 0);
});

test("explicit demo mode can use its sample presentation", () => {
  assert.equal(selectAutomaticPresentation("sample", sample), sample);
});
