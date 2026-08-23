import assert from "node:assert/strict";
import test from "node:test";

import type { AgentRunStepDto } from "@/lib/agent-runs/dto";

import {
  buildAgentCommandPayload,
  buildApprovalDecisionPayload,
  buildOrganicRunPayload,
  newAgentRequestId,
} from "../agent-run-client";

const REQUEST_ID = "123e4567-e89b-12d3-a456-426614174000";
const HASH = "0123456789abcdef".repeat(4);

function step(): AgentRunStepDto {
  return {
    id: "step_1",
    ordinal: 2,
    attempt: 1,
    toolName: "paid.create.paused",
    risk: "external",
    status: "waiting_approval",
    approvalBinding: {
      kind: "paid_create_paused",
      objectType: "paid_campaign_draft",
      objectId: "draft_1",
      objectVersion: 7,
      snapshotHash: HASH,
      accountId: "account_1",
      expiresAt: "2026-08-22T12:00:00.000Z",
    },
    output: null,
    error: null,
    createdAt: "2026-08-21T12:00:00.000Z",
    completedAt: null,
  };
}

test("organic start payload is bound to one brand and has no hidden target", () => {
  assert.deepEqual(
    buildOrganicRunPayload({
      brandId: "brand_1",
      goal: "  Build next week's posts  ",
      requestId: REQUEST_ID,
    }),
    {
      brandId: "brand_1",
      conversationId: null,
      goal: "Build next week's posts",
      mode: "organic",
      requestId: REQUEST_ID,
      target: null,
    },
  );
});

test("cancel and retry commands contain only a fresh request identity", () => {
  assert.deepEqual(buildAgentCommandPayload(REQUEST_ID), { requestId: REQUEST_ID });
  const first = newAgentRequestId();
  const second = newAgentRequestId();
  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.notEqual(first, second);
});

test("approval payload copies every exact server binding field", () => {
  assert.deepEqual(
    buildApprovalDecisionPayload({
      step: step(),
      decision: "accepted",
      requestId: REQUEST_ID,
    }),
    {
      requestId: REQUEST_ID,
      decision: "accepted",
      stepId: "step_1",
      kind: "paid_create_paused",
      objectType: "paid_campaign_draft",
      objectId: "draft_1",
      objectVersion: 7,
      snapshotHash: HASH,
      accountId: "account_1",
    },
  );
});

test("approval payload refuses a step without an exact binding", () => {
  const unbound = { ...step(), approvalBinding: null };
  assert.throws(
    () =>
      buildApprovalDecisionPayload({
        step: unbound,
        decision: "rejected",
        requestId: REQUEST_ID,
      }),
    /no exact approval binding/,
  );
});
