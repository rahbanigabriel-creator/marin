import assert from "node:assert/strict";
import test from "node:test";

import {
  createLivenessResponse,
  createReadinessResponse,
  livenessResult,
  readinessResult,
} from "@/lib/operations/health";

test("liveness is fast, stable, and explicitly non-cacheable", async () => {
  assert.deepEqual(livenessResult(), { status: "ok" });

  const response = createLivenessResponse();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("readiness reports only a successful database component", async () => {
  let calls = 0;
  const result = await readinessResult({
    pingDatabase: async () => {
      calls += 1;
      return { ignored: "postgresql://user:secret@private.example/database" };
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    status: "ready",
    components: [{ name: "database", status: "up" }],
  });

  const response = await createReadinessResponse({
    pingDatabase: async () => undefined,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
});

test("readiness converts database failures into a safe 503 response", async () => {
  const response = await createReadinessResponse({
    pingDatabase: async () => {
      throw new Error(
        "connect ECONNREFUSED postgresql://owner:raw-secret@db.internal:5432/marpin",
      );
    },
  });

  assert.equal(response.status, 503);
  const body = await response.text();
  assert.equal(
    body,
    '{"status":"not_ready","components":[{"name":"database","status":"down"}]}',
  );
  assert.equal(body.includes("raw-secret"), false);
  assert.equal(body.includes("db.internal"), false);
  assert.equal(body.includes("ECONNREFUSED"), false);
});

test("readiness times out a non-cooperative database ping", async () => {
  const startedAt = Date.now();
  const response = await createReadinessResponse({
    pingDatabase: () => new Promise(() => undefined),
    timeoutMs: 10,
  });

  assert.equal(response.status, 503);
  assert.ok(Date.now() - startedAt < 500);
  assert.deepEqual(await response.json(), {
    status: "not_ready",
    components: [{ name: "database", status: "down" }],
  });
});

test("readiness never serializes values returned by the dependency", async () => {
  const response = await createReadinessResponse({
    pingDatabase: async () => ({
      host: "private-db.example",
      url: "postgresql://user:secret@private-db.example/marpin",
      stack: "sensitive stack trace",
    }),
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(body.includes("private-db.example"), false);
  assert.equal(body.includes("secret"), false);
  assert.equal(body.includes("stack"), false);
});
