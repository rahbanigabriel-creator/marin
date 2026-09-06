import assert from "node:assert/strict";
import test from "node:test";
import { verifyCurrentActor } from "../authority";
import { PaidAgentError } from "../policy";

const actorId = "user_test123";
const active = { id: actorId, banned: false, locked: false };
const admin = { total_count: 1, data: [{ role: "org:admin", organization: { id: "org_test123" }, public_user_data: { user_id: actorId } }] };
const errorCode = (code: string) => (error: unknown) => error instanceof PaidAgentError && error.code === code;

test("personal authority requires a live unbanned Clerk user and exact workspace ownership", async () => {
  let calls = 0;
  const read: typeof fetch = async (url, init) => {
    calls++; assert.equal(String(url), `https://api.clerk.com/v1/users/${actorId}`);
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    return Response.json(active);
  };
  await verifyCurrentActor({ actorId, workspaceSlug: `user-${actorId}` }, { secretKey: "test-only", fetch: read });
  assert.equal(calls, 1);
  await assert.rejects(() => verifyCurrentActor({ actorId, workspaceSlug: "user_other" }, { secretKey: "test-only", fetch: read }), errorCode("authority_revoked"));
  assert.equal(calls, 1);
});

test("organization authority uses one filtered membership page, not the stored role", async () => {
  const urls: URL[] = [];
  const read: typeof fetch = async (url) => { urls.push(new URL(String(url))); return Response.json(urls.length === 1 ? active : admin); };
  await verifyCurrentActor({ actorId, workspaceSlug: "org-org_test123" }, { secretKey: "test-only", fetch: read });
  assert.equal(urls.length, 2); assert.equal(urls[1].searchParams.get("user_id"), actorId); assert.equal(urls[1].searchParams.get("limit"), "1");
});

test("deleted, banned, locked, demoted, missing and malformed Clerk actors fail closed", async () => {
  const users = [{ ...active, banned: true }, { ...active, locked: true }, { id: actorId }, { ...active, id: "other" }];
  for (const user of users) await assert.rejects(() => verifyCurrentActor({ actorId, workspaceSlug: `user-${actorId}` }, { secretKey: "test-only", fetch: async () => Response.json(user) }), errorCode("authority_revoked"));
  for (const status of [404, 429, 500]) await assert.rejects(() => verifyCurrentActor({ actorId, workspaceSlug: `user-${actorId}` }, { secretKey: "test-only", fetch: async () => new Response("unavailable", { status }) }), errorCode(status === 404 ? "authority_revoked" : "authority_unavailable"));
  for (const membership of [{ ...admin, total_count: 0, data: [] }, { ...admin, data: [{ ...admin.data[0], role: "org:member" }] }, { ...admin, data: [{ ...admin.data[0], public_user_data: { user_id: "other" } }] }]) {
    let calls = 0;
    await assert.rejects(() => verifyCurrentActor({ actorId, workspaceSlug: "org-org_test123" }, { secretKey: "test-only", fetch: async () => Response.json(++calls === 1 ? active : membership) }), errorCode("authority_revoked"));
    assert.equal(calls, 2);
  }
});

test("unconfigured authority, oversized responses and network failure never grant access", async () => {
  let calls = 0;
  await assert.rejects(() => verifyCurrentActor({ actorId, workspaceSlug: `user-${actorId}` }, { secretKey: "", fetch: async () => { calls++; return Response.json(active); } }), errorCode("authority_unavailable"));
  assert.equal(calls, 0);
  for (const read of [async () => new Response("x".repeat(65537)), async () => { throw new Error("unavailable"); }]) {
    await assert.rejects(() => verifyCurrentActor({ actorId, workspaceSlug: `user-${actorId}` }, { secretKey: "test-only", fetch: read }), errorCode("authority_unavailable"));
  }
});

test("authority bounds stalled fetch and body even when a transport ignores cancellation", async () => {
  for (const body of [false, true]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15);
    try {
      await assert.rejects(() => verifyCurrentActor({ actorId, workspaceSlug: `user-${actorId}` }, {
        secretKey: "test-only", signal: controller.signal,
        fetch: async () => body ? new Response(new ReadableStream({ pull: () => new Promise(() => {}) })) : new Promise(() => {}),
      }), errorCode("authority_unavailable"));
    } finally { clearTimeout(timeout); }
  }
});
