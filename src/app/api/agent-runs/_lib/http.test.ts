import assert from "node:assert/strict";
import test from "node:test";

import { POST as createRunRoute } from "@/app/api/agent-runs/route";
import { WorkspaceAuthorizationError } from "@/lib/auth";
import { AgentRunEntitlementError } from "@/lib/agent-runs/errors";
import { parseAgentRunRequest } from "@/lib/agent-runs/validation";
import { agentRunApiFailure } from "@/app/api/agent-runs/_lib/http";

test("agent-run route rejects cross-origin mutations before auth and persistence", async () => {
  const previous = {
    VERCEL: process.env.VERCEL,
    APP_URL: process.env.APP_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
  process.env.VERCEL = "1";
  process.env.APP_URL = "https://www.marpin.ai";
  process.env.NEXT_PUBLIC_APP_URL = "https://www.marpin.ai";
  try {
    const response = await createRunRoute(new Request(
      "https://www.marpin.ai/api/agent-runs",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://attacker.example" },
        body: "{}",
      },
    ));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "forbidden",
      code: "invalid_request_origin",
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("agent-run HTTP errors distinguish authorization and entitlement without leaking data", async () => {
  const forbidden = agentRunApiFailure(new WorkspaceAuthorizationError(), "test");
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).code, "forbidden");

  const upgrade = agentRunApiFailure(new AgentRunEntitlementError(), "test");
  assert.equal(upgrade.status, 403);
  assert.deepEqual(await upgrade.json(), {
    error: "agent_runs_upgrade_required",
    code: "agent_runs_upgrade_required",
    message: "Agent runs require a plan with automated actions",
    actionUrl: "/settings/billing",
  });
});

test("agent-run route body cannot supply execution controls or provider payloads", () => {
  assert.throws(() => parseAgentRunRequest({
    brandId: "brand-1",
    conversationId: null,
    goal: "Prepare the weekly plan",
    mode: "organic",
    requestId: "run_request_789",
    providerPayload: { campaign: "untrusted" },
  }), /unsupported field/);
});
