import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceAuthorizationError } from "@/lib/auth";
import { ConnectionNotFoundError } from "@/lib/connectors/disconnect";
import { createDeleteConnectionHandler } from "@/lib/connectors/disconnect-route";

function request(origin = "https://www.marpin.ai") {
  return new Request("https://www.marpin.ai/api/connections/connection_1", {
    method: "DELETE",
    headers: {
      Origin: origin,
      "Sec-Fetch-Site": origin === "https://www.marpin.ai" ? "same-origin" : "cross-site",
    },
  });
}

function context(connectionId = "connection_1") {
  return { params: Promise.resolve({ connectionId }) };
}

function dependencies(overrides: Partial<Parameters<typeof createDeleteConnectionHandler>[0]> = {}) {
  return {
    databaseConfigured: () => true,
    requireAccess: async () => ({ workspace: { id: "workspace_1" } }),
    disconnect: async (input: { workspaceId: string; connectionId: string }) => ({
      connectionId: input.connectionId,
      disconnected: true as const,
      providerRevocation: "confirmed" as const,
      message: "Connection removed.",
    }),
    ...overrides,
  };
}

test("disconnect route rejects cross-origin mutations before any dependency runs", async () => {
  let called = false;
  const handler = createDeleteConnectionHandler(dependencies({
    requireAccess: async () => {
      called = true;
      return { workspace: { id: "workspace_1" } };
    },
  }));

  const response = await handler(request("https://attacker.example"), context());
  assert.equal(response.status, 403);
  assert.equal(called, false);
  assert.deepEqual(await response.json(), {
    error: "forbidden",
    code: "invalid_request_origin",
  });
});

test("disconnect route rejects malformed ids before auth and mutation", async () => {
  let called = false;
  const handler = createDeleteConnectionHandler(dependencies({
    requireAccess: async () => {
      called = true;
      return { workspace: { id: "workspace_1" } };
    },
  }));

  const response = await handler(request(), context("../other-workspace"));
  assert.equal(response.status, 404);
  assert.equal(called, false);
});

test("disconnect route requires an owner or admin", async () => {
  const handler = createDeleteConnectionHandler(dependencies({
    requireAccess: async () => {
      throw new WorkspaceAuthorizationError();
    },
  }));

  const response = await handler(request(), context());
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "forbidden" });
});

test("disconnect route keeps missing and cross-tenant ids indistinguishable", async () => {
  const handler = createDeleteConnectionHandler(dependencies({
    disconnect: async () => {
      throw new ConnectionNotFoundError();
    },
  }));

  const response = await handler(request(), context());
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
});

test("disconnect route passes only the authenticated workspace and validated id", async () => {
  let received: { workspaceId: string; connectionId: string } | undefined;
  const handler = createDeleteConnectionHandler(dependencies({
    disconnect: async (input) => {
      received = input;
      return {
        connectionId: input.connectionId,
        disconnected: true,
        providerRevocation: "retained",
        message: "Connection removed locally.",
      };
    },
  }));

  const response = await handler(request(), context());
  assert.equal(response.status, 200);
  assert.deepEqual(received, { workspaceId: "workspace_1", connectionId: "connection_1" });
  assert.equal((await response.json()).providerRevocation, "retained");
});
