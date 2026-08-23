import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export const MANUAL_CREATION_OPERATIONS = [
  "content_plan_create",
  "content_post_create",
  "content_item_create",
  "content_variant_create",
  "publication_create",
  "conversation_create",
] as const;

export type ManualCreationOperation = (typeof MANUAL_CREATION_OPERATIONS)[number];

export class ManualCreationRequestError extends Error {
  readonly code = "invalid_request_id";

  constructor() {
    super("requestId must be 10 to 100 letters, numbers, underscores, or hyphens");
    this.name = "ManualCreationRequestError";
  }
}

export class ManualCreationConflictError extends Error {
  readonly code = "idempotency_conflict";

  constructor() {
    super("requestId was already used for a different payload");
    this.name = "ManualCreationConflictError";
  }
}

export function parseManualCreationRequestId(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ManualCreationRequestError();
  }
  const requestId = (value as Record<string, unknown>).requestId;
  if (typeof requestId !== "string") throw new ManualCreationRequestError();
  const normalized = requestId.trim();
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(normalized)) {
    throw new ManualCreationRequestError();
  }
  return normalized;
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Idempotency payload numbers must be finite");
  }
  return value;
}

export function manualCreationRequestHash(value: unknown): string {
  const encoded = JSON.stringify(canonicalize(value));
  if (encoded === undefined) throw new Error("An idempotency payload is required");
  return createHash("sha256").update(encoded).digest("hex");
}

function cloneResponse<T extends Record<string, unknown>>(value: unknown): T {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("An idempotent response body is required");
  return JSON.parse(encoded) as T;
}

export interface ManualCreationResult<T extends Record<string, unknown>> {
  body: T;
  status: number;
  replayed: boolean;
}

export async function runManualCreation<T extends Record<string, unknown>>(input: {
  workspaceId: string;
  operation: ManualCreationOperation;
  requestId: string;
  request: unknown;
  create: (tx: Prisma.TransactionClient) => Promise<{ body: T; status: number }>;
}): Promise<ManualCreationResult<T>> {
  const requestId = parseManualCreationRequestId({ requestId: input.requestId });
  const requestHash = manualCreationRequestHash(input.request);

  return prisma.$transaction(
    async (tx) => {
      const workspace = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "workspaces" WHERE "id" = ${input.workspaceId} FOR UPDATE
      `;
      if (!workspace.length) throw new Error("Workspace not found");

      const existing = await tx.manualCreationRequest.findFirst({
        where: {
          workspaceId: input.workspaceId,
          operation: input.operation,
          requestId,
        },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ManualCreationConflictError();
        }
        return {
          body: cloneResponse<T>(existing.responseBody),
          status: existing.statusCode,
          replayed: true,
        };
      }

      const created = await input.create(tx);
      if (!Number.isSafeInteger(created.status) || created.status < 100 || created.status > 599) {
        throw new Error("An idempotent response requires a valid HTTP status");
      }
      const responseBody = cloneResponse<T>(created.body);
      await tx.manualCreationRequest.create({
        data: {
          workspaceId: input.workspaceId,
          operation: input.operation,
          requestId,
          requestHash,
          responseBody: responseBody as Prisma.InputJsonObject,
          statusCode: created.status,
        },
      });
      return { body: responseBody, status: created.status, replayed: false };
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

export function manualCreationErrorResult(error: unknown): {
  status: 409 | 422;
  body: { error: string; code: string; message: string };
} | null {
  if (error instanceof ManualCreationConflictError) {
    return {
      status: 409,
      body: { error: error.code, code: error.code, message: error.message },
    };
  }
  if (error instanceof ManualCreationRequestError) {
    return {
      status: 422,
      body: { error: error.code, code: error.code, message: error.message },
    };
  }
  return null;
}
