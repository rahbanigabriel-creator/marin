import { createHash } from "node:crypto";

function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Cannot hash a non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Cannot hash an unsupported value");
}

export function canonicalAgentValue(value: unknown): string {
  return canonical(value);
}

export function agentSnapshotHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function agentToolIdempotencyKey(input: {
  runId: string;
  ordinal: number;
  toolName: string;
}): string {
  if (!input.runId || !Number.isSafeInteger(input.ordinal) || input.ordinal < 1 || !input.toolName) {
    throw new TypeError("A valid run, ordinal, and tool are required");
  }
  return `${input.runId}:${input.ordinal}:${input.toolName}`;
}
