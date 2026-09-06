import assert from "node:assert/strict";
import test from "node:test";
import { NotAuthenticatedError, WorkspaceAuthorizationError } from "@/lib/auth";
import { createMeasurementHandler, type MeasurementRouteDependencies } from "../route";
import { buildMeasurementAnalytics } from "../service";
import { now, range } from "./fixtures";

function dependencies(overrides: Partial<MeasurementRouteDependencies> = {}): MeasurementRouteDependencies {
  return {
    databaseConfigured: () => true,
    requireAccess: async () => ({ workspace: { id: "workspace-1" } }),
    read: async (workspaceId, requestedRange) => buildMeasurementAnalytics({ workspaceId, range: requestedRange, now, snapshot: { connections: [], facts: [] } }),
    ...overrides,
  };
}
const request = (query = "from=2026-09-01&to=2026-09-03") => new Request(`https://example.test/api/measurement-analytics?${query}`);

test("route uses only authenticated workspace and validated dates, with private no-store caching", async () => {
  let calls = 0;
  const response = await createMeasurementHandler(dependencies({ read: async (workspaceId, requested) => {
    calls++;
    assert.equal(workspaceId, "workspace-1");
    assert.deepEqual(requested, range);
    return buildMeasurementAnalytics({ workspaceId, range: requested, now, snapshot: { connections: [], facts: [] } });
  } }))(request());
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("auth failures never read data and do not expose exception details", async () => {
  for (const [error, status] of [[new NotAuthenticatedError(), 401], [new WorkspaceAuthorizationError(), 403], [new Error("secret detail"), 503]] as const) {
    const response = await createMeasurementHandler(dependencies({ requireAccess: async () => { throw error; }, read: async () => { throw new Error("must not read"); } }))(request());
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /secret detail|must not read/);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("query tenant overrides, invalid dates, duplicate dates and oversized ranges are rejected", async () => {
  for (const query of ["workspaceId=foreign", "from=2026-02-30&to=2026-03-01", "from=2026-09-03&to=2026-09-01", "from=2026-09-01", "from=2026-09-01&from=2026-09-01&to=2026-09-03", "from=2024-01-01&to=2026-01-01"]) {
    let read = false;
    const response = await createMeasurementHandler(dependencies({ read: async () => { read = true; throw new Error("unexpected read"); } }))(request(query));
    assert.equal(response.status, 400, query);
    assert.equal(read, false);
  }
});

test("missing persistence, blank workspace and reader failure fail closed", async () => {
  const noDatabase = await createMeasurementHandler(dependencies({ databaseConfigured: () => false, requireAccess: async () => { throw new Error("must not authenticate"); } }))(request());
  assert.equal(noDatabase.status, 503);
  const blank = await createMeasurementHandler(dependencies({ requireAccess: async () => ({ workspace: { id: "" } }) }))(request());
  assert.equal(blank.status, 403);
  const failed = await createMeasurementHandler(dependencies({ read: async () => { throw new Error("database token secret"); } }))(request());
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /token|secret/);
});
