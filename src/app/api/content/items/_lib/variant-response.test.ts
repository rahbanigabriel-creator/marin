import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";

import { createContentVariantResponse } from "@/app/api/content/items/[contentItemId]/variants/_lib/response";
import type { WorkspaceAccess } from "@/lib/auth";
import type {
  ContentItemDto,
  ContentPostDto,
  CreateContentVariantInput,
} from "@/lib/content/types";
import {
  ManualCreationConflictError,
  manualCreationRequestHash,
} from "@/lib/idempotency/manual-creation";

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

const contentItem: ContentItemDto = {
  id: "item-1",
  brandId: "brand-1",
  planId: null,
  status: "draft",
  source: "manual",
  title: "Master idea",
  brief: null,
  coreCopy: "Master copy",
  objective: null,
  metadata: null,
  version: 2,
  approvedBy: null,
  approvedAt: null,
  createdAt: "2026-08-22T09:00:00.000Z",
  updatedAt: "2026-08-22T10:00:00.000Z",
};

const post: ContentPostDto = {
  contentItem: { ...contentItem, version: 3 },
  publication: {
    id: "publication-1",
    contentItemId: contentItem.id,
    channelAccountId: null,
    platform: "instagram",
    format: "post",
    status: "draft",
    title: "Instagram version",
    body: "Prepared Instagram copy",
    firstComment: null,
    linkUrl: null,
    scheduledAt: null,
    publishedAt: null,
    createdAt: "2026-08-22T10:00:00.000Z",
    updatedAt: "2026-08-22T10:00:00.000Z",
  },
};

function jsonRequest(body: unknown): Request {
  return new Request("https://www.marpin.ai/api/content/items/item-1/variants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function memoryVariantLedger() {
  type Ledger = NonNullable<Parameters<typeof createContentVariantResponse>[4]>;
  const records = new Map<string, {
    hash: string;
    body: { post: ContentPostDto };
    status: number;
  }>();
  const ledger: Ledger = async (input) => {
    assert.equal(input.operation, "content_variant_create");
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

test("content variant creation requires requestId and replays one identical create", async () => {
  const ledger = memoryVariantLedger();
  let calls = 0;
  const operation = async (
    input: CreateContentVariantInput,
    transaction?: Prisma.TransactionClient,
  ) => {
    calls += 1;
    assert.ok(transaction);
    assert.equal(input.contentItemId, contentItem.id);
    return post;
  };
  const body = {
    requestId: "content_variant_create_001",
    expectedVersion: 2,
    platform: "instagram",
    format: "post",
    title: "Instagram version",
    body: "Prepared Instagram copy",
    status: "draft",
    scheduledAt: null,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await createContentVariantResponse(
      jsonRequest(body),
      access,
      contentItem.id,
      operation,
      ledger,
    );
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { post });
  }
  assert.equal(calls, 1);

  const conflict = await createContentVariantResponse(
    jsonRequest({ ...body, body: "Changed retry" }),
    access,
    contentItem.id,
    operation,
    ledger,
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "idempotency_conflict");
  assert.equal(calls, 1);

  const missing = await createContentVariantResponse(
    jsonRequest({ ...body, requestId: undefined }),
    access,
    contentItem.id,
    operation,
    ledger,
  );
  assert.equal(missing.status, 422);
  assert.equal((await missing.json()).code, "invalid_request_id");
  assert.equal(calls, 1);
});
