import assert from "node:assert/strict";
import test from "node:test";

import {
  canInvokeAgentTool,
  checkAgentApproval,
  requiresHumanApproval,
} from "@/lib/agent-runs/capabilities";
import { buildAgentContext } from "@/lib/agent-runs/context";
import { createAgentPublicEvent } from "@/lib/agent-runs/events";
import {
  agentSnapshotHash,
  agentToolIdempotencyKey,
} from "@/lib/agent-runs/hash";
import {
  boundedRunLimits,
  canTransitionAgentRun,
  parseAgentApprovalDecision,
  parseAgentRunCommand,
  parseAgentRunListQuery,
  parseAgentRunRequest,
} from "@/lib/agent-runs/validation";
import { agentPlanForMode } from "@/lib/agent-runs/registry";

test("run input is bounded and rejects client-owned execution fields", () => {
  assert.deepEqual(parseAgentRunRequest({
    brandId: "brand-1",
    conversationId: null,
    goal: "Prepare next week's organic plan",
    mode: "organic",
    requestId: "run_request_123",
    target: null,
  }), {
    brandId: "brand-1",
    conversationId: null,
    goal: "Prepare next week's organic plan",
    mode: "organic",
    requestId: "run_request_123",
    target: null,
  });
  assert.throws(() => parseAgentRunRequest({
    brandId: "brand-1",
    goal: "Launch it",
    mode: "paid",
    requestId: "run_request_123",
    execute: true,
  }), /unsupported field/);
});

test("canonical hashes ignore object-key order but bind semantic arrays", () => {
  assert.equal(agentSnapshotHash({ b: 2, a: [1, 2] }), agentSnapshotHash({ a: [1, 2], b: 2 }));
  assert.notEqual(agentSnapshotHash({ a: [1, 2] }), agentSnapshotHash({ a: [2, 1] }));
  assert.equal(agentToolIdempotencyKey({ runId: "run-1", ordinal: 2, toolName: "content.create" }), "run-1:2:content.create");
});

test("limits cannot exceed server defaults and failed runs need explicit retry", () => {
  assert.equal(boundedRunLimits({ maxSteps: 8 }).maxSteps, 8);
  assert.throws(() => boundedRunLimits({ maxSteps: 25 }), /exceeds/);
  assert.equal(canTransitionAgentRun("failed", "running"), false);
  assert.equal(canTransitionAgentRun("failed", "running", { explicitRetry: true }), true);
  assert.equal(canTransitionAgentRun("succeeded", "running", { explicitRetry: true }), false);
});

test("tool policy enforces role, entitlement, call ceiling, and approval risk", () => {
  const policy = {
    name: "paid.createPaused",
    risk: "spend" as const,
    roles: ["owner", "admin"] as const,
    entitlement: "paidActions",
    maxCalls: 1,
  };
  assert.equal(canInvokeAgentTool({ policy, role: "owner", entitlements: new Set(["paidActions"]), callsUsed: 0 }), true);
  assert.equal(canInvokeAgentTool({ policy, role: "member", entitlements: new Set(["paidActions"]), callsUsed: 0 }), false);
  assert.equal(canInvokeAgentTool({ policy, role: "owner", entitlements: new Set(), callsUsed: 0 }), false);
  assert.equal(canInvokeAgentTool({ policy, role: "owner", entitlements: new Set(["paidActions"]), callsUsed: 1 }), false);
  assert.equal(requiresHumanApproval(policy), true);
});

test("approvals bind kind, object, version, snapshot, account, and expiry", () => {
  const approval = {
    kind: "paid_create_paused" as const,
    objectType: "campaign",
    objectId: "campaign-1",
    objectVersion: 3,
    snapshotHash: "a".repeat(64),
    accountId: "account-1",
    expiresAt: "2026-08-22T00:00:00.000Z",
  };
  const base = {
    approval,
    kind: approval.kind,
    objectType: approval.objectType,
    objectId: approval.objectId,
    objectVersion: approval.objectVersion,
    snapshotHash: approval.snapshotHash,
    accountId: approval.accountId,
    now: new Date("2026-08-21T00:00:00.000Z"),
  };
  assert.deepEqual(checkAgentApproval(base), { allowed: true, reason: "approved" });
  assert.equal(checkAgentApproval({ ...base, objectVersion: 4 }).reason, "wrong_version");
  assert.equal(checkAgentApproval({ ...base, accountId: "account-2" }).reason, "wrong_account");
  assert.equal(checkAgentApproval({ ...base, now: new Date(approval.expiresAt) }).reason, "expired");
});

test("context is truncated, verified status is retained, and secrets are redacted", () => {
  const context = buildAgentContext({
    brandId: "brand-1",
    contextVersion: 2,
    mode: "seo",
    timezone: "Europe/Madrid",
    facts: Array.from({ length: 90 }, (_, index) => ({
      key: `fact-${index}`,
      value: index === 0 ? "access_token=do-not-leak" : `value-${index}`,
      source: "crawl",
      observedAt: null,
      verificationStatus: index === 1 ? "verified" as const : "unverified" as const,
    })),
    recentTurns: Array.from({ length: 15 }, (_, index) => ({
      role: index % 2 ? "assistant" as const : "user" as const,
      content: `turn-${index}`,
    })),
  });
  assert.equal(context.facts.length, 80);
  assert.equal(context.facts[0].value, "[redacted]");
  assert.equal(context.facts[1].verificationStatus, "verified");
  assert.equal(context.recentTurns.length, 10);
  assert.equal(context.recentTurns[0].content, "turn-5");
});

test("public events reject reasoning and credentials", () => {
  assert.deepEqual(createAgentPublicEvent({
    type: "object_created",
    label: "Created weekly plan",
    detail: "Seven draft publications",
    objectType: "content_plan",
    objectId: "plan-1",
    evidenceIds: ["audit-1"],
  }), {
    type: "object_created",
    label: "Created weekly plan",
    detail: "Seven draft publications",
    objectType: "content_plan",
    objectId: "plan-1",
    evidenceIds: ["audit-1"],
  });
  assert.throws(() => createAgentPublicEvent({
    type: "run_started",
    label: "Hidden reasoning follows",
  }), /Unsafe/);
  assert.throws(() => createAgentPublicEvent({
    type: "run_started",
    label: "Started",
    detail: "Bearer abc123",
  }), /Unsafe/);
});

test("run and approval parsers reject secrets, unknown fields, and weak bindings", () => {
  assert.throws(() => parseAgentRunRequest({
    brandId: "brand-1",
    conversationId: null,
    goal: "Use access_token=secret to prepare posts",
    mode: "organic",
    requestId: "run_request_456",
  }), /sensitive content/);
  assert.deepEqual(parseAgentRunCommand({ requestId: "cancel_request_123" }), {
    requestId: "cancel_request_123",
  });
  assert.throws(() => parseAgentRunCommand({
    requestId: "cancel_request_123",
    force: true,
  }), /unsupported field/);
  assert.throws(() => parseAgentApprovalDecision({
    requestId: "approval_request_123",
    decision: "accepted",
    stepId: "step-1",
    kind: "paid_activate",
    objectType: "paid_campaign_draft",
    objectId: "draft-1",
    objectVersion: 1,
    snapshotHash: "not-a-hash",
    accountId: "account-1",
  }), /snapshotHash/);
});

test("list query is strict and the registry exposes only reviewed behaviors", () => {
  assert.deepEqual(parseAgentRunListQuery(new Request(
    "https://www.marpin.ai/api/agent-runs?status=queued&limit=20&brandId=brand-1",
  )), { status: "queued", limit: 20, brandId: "brand-1" });
  assert.throws(() => parseAgentRunListQuery(new Request(
    "https://www.marpin.ai/api/agent-runs?status=queued&status=running",
  )), /query is invalid/);
  assert.throws(() => parseAgentRunListQuery(new Request(
    "https://www.marpin.ai/api/agent-runs?providerPayload=yes",
  )), /query is invalid/);
  assert.equal(agentPlanForMode("organic").behavior, "create_weekly_content_plan");
  assert.equal(agentPlanForMode("paid").behavior, "request_input");
  assert.equal(agentPlanForMode("organic").tool.risk, "internal_write");
});
