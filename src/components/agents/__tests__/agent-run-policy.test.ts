import assert from "node:assert/strict";
import test from "node:test";

import type { AgentRunDto, AgentRunStepDto } from "@/lib/agent-runs/dto";

import {
  agentRunActionPolicy,
  agentRunStatusLabel,
  pendingApprovalStep,
  safeFailureMessage,
  shortHashSuffix,
  shouldPollAgentRun,
} from "../agent-run-policy";

const NOW = "2026-08-21T12:00:00.000Z";
const HASH = "a".repeat(56) + "1234abcd";

function approvalStep(): AgentRunStepDto {
  return {
    id: "step_approval",
    ordinal: 1,
    attempt: 1,
    toolName: "paid.create.paused",
    risk: "external",
    status: "waiting_approval",
    approvalBinding: {
      kind: "paid_create_paused",
      objectType: "paid_campaign_draft",
      objectId: "draft_1",
      objectVersion: 4,
      snapshotHash: HASH,
      accountId: "account_1",
      expiresAt: "2026-08-22T12:00:00.000Z",
    },
    output: null,
    error: null,
    createdAt: NOW,
    completedAt: null,
  };
}

function run(overrides: Partial<AgentRunDto> = {}): AgentRunDto {
  return {
    id: "run_1",
    brandId: "brand_1",
    conversationId: null,
    mode: "organic",
    goal: "Create a seven-day organic plan",
    planKey: "organic_weekly_plan",
    target: null,
    status: "queued",
    dispatchStatus: "pending",
    dispatchErrorCode: null,
    limits: { maxSteps: 24, maxToolCalls: 40, maxModelTurns: 12, maxWebReads: 6, maxCredits: 20 },
    usage: { steps: 0, toolCalls: 0, modelTurns: 0, webReads: 0, credits: 0 },
    attempt: 1,
    version: 1,
    failure: null,
    deadlineAt: "2026-08-21T12:15:00.000Z",
    cancelRequestedAt: null,
    startedAt: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    steps: [],
    events: [],
    approvals: [],
    ...overrides,
  };
}

test("members never receive mutation controls", () => {
  assert.deepEqual(agentRunActionPolicy(run({ status: "running" }), false), {
    canCancel: false,
    canRetry: false,
    canDecideApproval: false,
  });
});

test("action policy mirrors terminal and dispatch behavior", () => {
  assert.equal(agentRunActionPolicy(run({ status: "running" }), true).canCancel, true);
  assert.equal(
    agentRunActionPolicy(run({ status: "running", cancelRequestedAt: NOW }), true).canCancel,
    false,
  );
  assert.equal(agentRunActionPolicy(run({ status: "failed" }), true).canRetry, true);
  assert.equal(agentRunActionPolicy(run({ status: "cancelled" }), true).canRetry, false);
  assert.equal(
    agentRunActionPolicy(
      run({ status: "queued", dispatchStatus: "unavailable" }),
      true,
    ).canRetry,
    true,
  );
  assert.equal(agentRunActionPolicy(run({ status: "succeeded" }), true).canCancel, false);
});

test("polling stops for terminal, waiting, and dispatch-unavailable runs", () => {
  assert.equal(shouldPollAgentRun(run({ status: "queued", dispatchStatus: "sent" })), true);
  assert.equal(shouldPollAgentRun(run({ status: "running" })), true);
  assert.equal(
    shouldPollAgentRun(run({ status: "queued", dispatchStatus: "unavailable" })),
    false,
  );
  assert.equal(shouldPollAgentRun(run({ status: "waiting_approval" })), false);
  assert.equal(shouldPollAgentRun(run({ status: "succeeded" })), false);
});

test("only an undecided exact waiting step is actionable", () => {
  const step = approvalStep();
  const waiting = run({ status: "waiting_approval", steps: [step] });
  assert.equal(pendingApprovalStep(waiting)?.id, step.id);
  assert.equal(agentRunActionPolicy(waiting, true).canDecideApproval, true);

  const decided = run({
    status: "waiting_approval",
    steps: [step],
    approvals: [
      {
        id: "approval_1",
        stepId: step.id,
        decision: "accepted",
        kind: "paid_create_paused",
        objectType: "paid_campaign_draft",
        objectId: "draft_1",
        objectVersion: 4,
        snapshotHash: HASH,
        accountId: "account_1",
        expiresAt: "2026-08-22T12:00:00.000Z",
        decidedAt: NOW,
      },
    ],
  });
  assert.equal(pendingApprovalStep(decided), null);
});

test("status and failure copy stay safe and hashes are shortened", () => {
  assert.equal(
    agentRunStatusLabel(run({ status: "queued", dispatchStatus: "unavailable" })),
    "Worker unavailable",
  );
  assert.match(safeFailureMessage("approval_stale"), /changed/);
  assert.equal(safeFailureMessage("raw_provider_exception"), "The run stopped safely before it completed.");
  assert.equal(shortHashSuffix(HASH), "...1234abcd");
});
