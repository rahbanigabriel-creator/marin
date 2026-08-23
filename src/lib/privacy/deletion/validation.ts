import { createHash } from "node:crypto";

import { DeletionValidationError } from "@/lib/privacy/deletion/errors";
import type { CreateDeletionInput, RetryDeletionInput } from "@/lib/privacy/deletion/types";

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/;

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DeletionValidationError("invalid_body", "A JSON object is required");
  }
  const body = value as Record<string, unknown>;
  const actual = Object.keys(body).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new DeletionValidationError("invalid_body", "The request contains unsupported fields");
  }
  return body;
}

function parseRequestId(value: unknown): string {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) {
    throw new DeletionValidationError(
      "invalid_request_id",
      "requestId must be 8-100 URL-safe characters",
    );
  }
  return value;
}

export function deletionConfirmationPhrase(workspaceSlug: string): string {
  return `DELETE ${workspaceSlug}`;
}

export function parseCreateDeletionInput(value: unknown): CreateDeletionInput {
  const body = exactObject(value, ["confirmation", "requestId"]);
  if (typeof body.confirmation !== "string" || body.confirmation.length > 220) {
    throw new DeletionValidationError(
      "invalid_confirmation",
      "The confirmation phrase is invalid",
    );
  }
  return { requestId: parseRequestId(body.requestId), confirmation: body.confirmation };
}

export function parseRetryDeletionInput(value: unknown): RetryDeletionInput {
  const body = exactObject(value, ["requestId"]);
  return { requestId: parseRequestId(body.requestId) };
}

function digest(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(part.length), "utf8");
    hash.update(":", "utf8");
    hash.update(part, "utf8");
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

export function createDeletionRequestHash(input: {
  workspaceSlug: string;
  requestId: string;
  confirmation: string;
}): string {
  return digest(["workspace-deletion:create:v1", input.workspaceSlug, input.requestId, input.confirmation]);
}

export function retryDeletionRequestHash(input: {
  deletionRequestId: string;
  requestId: string;
}): string {
  return digest(["workspace-deletion:retry:v1", input.deletionRequestId, input.requestId]);
}
