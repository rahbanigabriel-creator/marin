import { createHash } from "node:crypto";

import { parsePaidCampaignSnapshotV1 } from "./validation";

export type PaidSnapshotDiffCategory =
  | "identity"
  | "account"
  | "campaign"
  | "budget"
  | "schedule"
  | "targeting"
  | "creative"
  | "assumptions";

export interface PaidSnapshotDiff {
  readonly path: string;
  readonly category: PaidSnapshotDiffCategory;
  readonly kind: "added" | "removed" | "changed";
  readonly before?: unknown;
  readonly after?: unknown;
}

export function canonicalPaidDraftJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalPaidDraftJson(item)).join(",")}]`;
  }
  const body = value as Record<string, unknown>;
  return `{${Object.keys(body)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalPaidDraftJson(body[key])}`)
    .join(",")}}`;
}

export function canonicalPaidCampaignSnapshotJson(value: unknown): string {
  return canonicalPaidDraftJson(parsePaidCampaignSnapshotV1(value));
}

export function hashPaidCampaignSnapshotV1(value: unknown): string {
  return createHash("sha256").update(canonicalPaidCampaignSnapshotJson(value)).digest("hex");
}

export function hashPaidDraftRequest(value: unknown): string {
  return createHash("sha256").update(canonicalPaidDraftJson(value)).digest("hex");
}

function categoryFor(path: string): PaidSnapshotDiffCategory {
  if (path === "connection" || path.startsWith("connection.")) return "account";
  if (path === "campaign" || path.startsWith("campaign.")) return "campaign";
  if (path === "budget" || path.startsWith("budget.")) return "budget";
  if (path === "schedule" || path.startsWith("schedule.")) return "schedule";
  if (path.includes(".targeting")) return "targeting";
  if (path.includes(".ads")) return "creative";
  if (path === "assumptions" || path.startsWith("assumptions[")) return "assumptions";
  return "identity";
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return canonicalPaidDraftJson(left) === canonicalPaidDraftJson(right);
}

function collectDiffs(
  before: unknown,
  after: unknown,
  path: string,
  diffs: PaidSnapshotDiff[],
): void {
  if (valuesEqual(before, after)) return;

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const itemPath = `${path}[${index}]`;
      if (index >= before.length) {
        diffs.push({ path: itemPath, category: categoryFor(itemPath), kind: "added", after: after[index] });
      } else if (index >= after.length) {
        diffs.push({ path: itemPath, category: categoryFor(itemPath), kind: "removed", before: before[index] });
      } else {
        collectDiffs(before[index], after[index], itemPath, diffs);
      }
    }
    return;
  }

  if (
    before !== null &&
    after !== null &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const left = before as Record<string, unknown>;
    const right = after as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      const itemPath = path ? `${path}.${key}` : key;
      if (!(key in left)) {
        diffs.push({ path: itemPath, category: categoryFor(itemPath), kind: "added", after: right[key] });
      } else if (!(key in right)) {
        diffs.push({ path: itemPath, category: categoryFor(itemPath), kind: "removed", before: left[key] });
      } else {
        collectDiffs(left[key], right[key], itemPath, diffs);
      }
    }
    return;
  }

  diffs.push({ path, category: categoryFor(path), kind: "changed", before, after });
}

export function diffPaidCampaignSnapshotsV1(before: unknown, after: unknown): PaidSnapshotDiff[] {
  const validatedBefore = parsePaidCampaignSnapshotV1(before);
  const validatedAfter = parsePaidCampaignSnapshotV1(after);
  const diffs: PaidSnapshotDiff[] = [];
  collectDiffs(validatedBefore, validatedAfter, "", diffs);
  return diffs;
}
