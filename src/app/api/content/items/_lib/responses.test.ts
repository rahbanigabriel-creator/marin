import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";

import type { WorkspaceAccess } from "@/lib/auth";
import { ContentVersionConflictError } from "@/lib/content/errors";
import type { ContentItemDto, PatchContentItemInput } from "@/lib/content/types";
import {
  ManualCreationConflictError,
  manualCreationRequestHash,
} from "@/lib/idempotency/manual-creation";

import {
  createContentItemResponse,
  patchContentItemResponse,
} from "./responses";

const access: WorkspaceAccess = {
  workspace: {
    id: "workspace-1",
    slug: "workspace-1",
    name: "Workspace",
    isDev: false,
  },
  clerkUserId: "owner-1",
  role: "owner",
};

const item: ContentItemDto = {
  id: "item-1",
  brandId: "brand-1",
  planId: null,
  status: "approved",
  source: "manual",
  title: "Approved idea",
  brief: null,
  coreCopy: null,
  objective: null,
  metadata: null,
  version: 2,
  approvedBy: "owner-1",
  approvedAt: "2026-07-20T10:00:00.000Z",
  createdAt: "2026-07-20T09:00:00.000Z",
  updatedAt: "2026-07-20T10:00:00.000Z",
};

function jsonRequest(body: unknown): Request {
  return new Request("https://www.marpin.ai/api/content/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function memoryItemLedger() {
  type Ledger = NonNullable<Parameters<typeof createContentItemResponse>[3]>;
  const records = new Map<string, {
    hash: string;
    body: { contentItem: ContentItemDto };
    status: number;
  }>();
  const ledger: Ledger = async (input) => {
    assert.equal(input.operation, "content_item_create");
    const key = `${input.operation}:${input.requestId}`;
    const hash = manualCreationRequestHash(input.request);
    const existing = records.get(key);
    if (existing) {
      if (existing.hash !== hash) throw new ManualCreationConflictError();
      return { body: existing.body, status: existing.status, replayed: true };
    }
    const created = await input.create({} as Prisma.TransactionClient);
    records.set(key, { hash, body: created.body, status: created.status });
    return { ...created, replayed: false };
  };
  return ledger;
}

test("the route-bound create response rejects bundled creation approval", async () => {
  let called = false;
  const response = await createContentItemResponse(
    jsonRequest({
      requestId: "content_item_approval_001",
      brandId: "brand-1",
      title: "Cannot arrive approved",
      status: "approved",
    }),
    access,
    async () => {
      called = true;
      return item;
    },
  );

  assert.equal(response.status, 422);
  assert.equal(called, false);
  assert.deepEqual(await response.json(), {
    error: "approval_must_be_separate",
    code: "approval_must_be_separate",
    message: "Create content first, then approve the saved version",
  });
});

test("content item creation requires requestId and replays one identical create", async () => {
  const ledger = memoryItemLedger();
  let calls = 0;
  const operation = async (
    _input: Parameters<NonNullable<Parameters<typeof createContentItemResponse>[2]>>[0],
    transaction?: Prisma.TransactionClient,
  ) => {
    calls += 1;
    assert.ok(transaction);
    return item;
  };
  const body = {
    requestId: "content_item_create_001",
    brandId: "brand-1",
    title: "Retry-safe idea",
    status: "draft",
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await createContentItemResponse(
      jsonRequest(body),
      access,
      operation,
      ledger,
    );
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { contentItem: item });
  }
  assert.equal(calls, 1);

  const conflict = await createContentItemResponse(
    jsonRequest({ ...body, title: "Changed retry" }),
    access,
    operation,
    ledger,
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "idempotency_conflict");
  assert.equal(calls, 1);

  const missing = await createContentItemResponse(
    jsonRequest({ brandId: "brand-1", title: "Missing identity" }),
    access,
    operation,
    ledger,
  );
  assert.equal(missing.status, 422);
  assert.equal((await missing.json()).code, "invalid_request_id");
  assert.equal(calls, 1);
});

test("the route-bound patch response requires one explicit status-only approval", async () => {
  const calls: PatchContentItemInput[] = [];
  const missingIntent = await patchContentItemResponse(
    jsonRequest({ expectedVersion: 1, status: "approved" }),
    access,
    item.id,
    async (input) => {
      calls.push(input);
      return item;
    },
  );
  assert.equal(missingIntent.status, 422);
  assert.equal(calls.length, 0);
  assert.equal((await missingIntent.json()).code, "approval_intent_required");

  const bundledEdit = await patchContentItemResponse(
    jsonRequest({
      expectedVersion: 1,
      status: "approved",
      approvalIntent: true,
      title: "Smuggled revision",
    }),
    access,
    item.id,
    async (input) => {
      calls.push(input);
      return item;
    },
  );
  assert.equal(bundledEdit.status, 422);
  assert.equal(calls.length, 0);
  assert.equal((await bundledEdit.json()).code, "approval_must_be_separate");

  const approved = await patchContentItemResponse(
    jsonRequest({ expectedVersion: 1, status: "approved", approvalIntent: true }),
    access,
    item.id,
    async (input) => {
      calls.push(input);
      return item;
    },
  );
  assert.equal(approved.status, 200);
  assert.equal(calls.length, 1);
  const captured = calls[0]!;
  assert.deepEqual(
    {
      expectedVersion: captured.expectedVersion,
      status: captured.status,
      approvalIntent: captured.approvalIntent,
      title: captured.title,
    },
    {
      expectedVersion: 1,
      status: "approved",
      approvalIntent: true,
      title: undefined,
    },
  );
});

test("the route-bound patch response exposes optimistic conflicts", async () => {
  const response = await patchContentItemResponse(
    jsonRequest({ expectedVersion: 1, title: "Stale revision" }),
    access,
    item.id,
    async () => {
      throw new ContentVersionConflictError(4);
    },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "version_conflict",
    code: "version_conflict",
    message: "The content item changed since it was loaded",
    currentVersion: 4,
  });
});
