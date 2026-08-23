import assert from "node:assert/strict";
import test from "node:test";

import { parseSseChunk } from "@/lib/streaming/sse";

test("parseSseChunk preserves a frame split across network reads", () => {
  const first = parseSseChunk("", 'data: {"type":"text-delta","text":"hel');
  assert.deepEqual(first.events, []);

  const second = parseSseChunk(first.remainder, 'lo"}\n\n');
  assert.deepEqual(second.events, [{ type: "text-delta", text: "hello" }]);
  assert.equal(second.remainder, "");
});

test("parseSseChunk returns every complete event and keeps the trailing partial", () => {
  const parsed = parseSseChunk(
    "",
    'event: message\ndata: {"type":"start","question":"Audit me"}\n\n' +
      ': heartbeat\ndata: {"type":"done"}\n\n' +
      'data: {"type":"status"',
  );

  assert.deepEqual(parsed.events, [
    { type: "start", question: "Audit me" },
    { type: "done" },
  ]);
  assert.equal(parsed.remainder, 'data: {"type":"status"');
});

test("parseSseChunk turns malformed complete data into a safe retry error", () => {
  assert.throws(
    () => parseSseChunk("", "data: definitely-not-json\n\n"),
    /malformed response/i,
  );
});
