import assert from "node:assert/strict";
import test from "node:test";

import { restoreConversation } from "@/lib/conversations/client";
import type { ConversationDto } from "@/lib/conversations/types";

const conversation: ConversationDto = {
  id: "conversation-1",
  brandId: "brand-1",
  title: "Growth plan",
  mode: "organic",
  status: "active",
  lastMessageAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T10:00:00.000Z",
  preview: "Second answer",
  messages: [
    {
      id: "m1",
      turnId: "t1",
      role: "user",
      content: "First question",
      metadata: null,
      createdAt: "2026-07-20T09:00:00.000Z",
    },
    {
      id: "m2",
      turnId: "t1",
      role: "assistant",
      content: "First answer",
      metadata: null,
      createdAt: "2026-07-20T09:00:01.000Z",
    },
    {
      id: "m3",
      turnId: "t2",
      role: "user",
      content: "Second question",
      metadata: null,
      createdAt: "2026-07-20T10:00:00.000Z",
    },
    {
      id: "m4",
      turnId: "t2",
      role: "assistant",
      content: "Second answer",
      metadata: {
        dataMode: "live",
        choices: [{ question: "Which market?", options: ["Spain", "Europe"] }],
        closing: { split: "Next", thread: "Next" },
        artifacts: [],
      },
      createdAt: "2026-07-20T10:00:01.000Z",
    },
  ],
};

test("restoreConversation rebuilds prior turns and the latest answer", () => {
  const restored = restoreConversation(conversation);
  assert.deepEqual(restored.turns, [{ question: "First question", answer: "First answer" }]);
  assert.equal(restored.question, "Second question");
  assert.equal(restored.answer, "Second answer");
  assert.equal(restored.dataMode, "live");
  assert.equal(restored.choices?.questions[0]?.question, "Which market?");
});

test("restoreConversation preserves a pending user message without inventing an answer", () => {
  const restored = restoreConversation({
    ...conversation,
    messages: conversation.messages.slice(0, 3),
  });
  assert.equal(restored.question, "Second question");
  assert.equal(restored.answer, "");
  assert.equal(restored.dataMode, "empty");
});
