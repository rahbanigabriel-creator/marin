import assert from "node:assert/strict";
import test from "node:test";

import { abortableDelay, raceWithAbort } from "@/lib/streaming/deadline";

test("abortableDelay rejects immediately when already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(abortableDelay(1_000, controller.signal), { name: "AbortError" });
});

test("abortableDelay cancels an in-flight reveal delay", async () => {
  const controller = new AbortController();
  const started = Date.now();
  const delay = abortableDelay(2_000, controller.signal);
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(delay, { name: "AbortError" });
  assert.ok(Date.now() - started < 500);
});

test("abortableDelay resolves when the deadline remains active", async () => {
  const controller = new AbortController();
  await abortableDelay(1, controller.signal);
  assert.equal(controller.signal.aborted, false);
});

test("raceWithAbort releases a caller from a non-cooperative operation", async () => {
  const controller = new AbortController();
  const never = new Promise<string>(() => {});
  const bounded = raceWithAbort(never, controller.signal);
  controller.abort();
  await assert.rejects(bounded, { name: "AbortError" });
});

test("raceWithAbort preserves successful results and operation failures", async () => {
  const controller = new AbortController();
  assert.equal(await raceWithAbort(Promise.resolve("done"), controller.signal), "done");
  await assert.rejects(
    raceWithAbort(Promise.reject(new Error("failed")), controller.signal),
    /failed/,
  );
});
