import type { Connection } from "@prisma/client";

import { getConnectionAccessToken, metaAppSecretProof } from "./clients";
import type { ConnectionTokenProvider } from "./paid-clients";
import { PaidProviderError, providerHttpError } from "./paid-errors";
import { META_GRAPH_VERSION } from "./registry";

export interface MetaPublishingPermissions {
  adsManagement: boolean;
  pagesShowList: boolean;
  pagesReadEngagement: boolean;
}

export interface MetaPublishingPage {
  id: string;
  name: string;
  /** Explicit Page ADVERTISE task plus all three live publishing permissions. */
  canAdvertise: boolean;
}

/** Observations only, not provider review, draft approval or write authorization. */
export interface MetaPublishingAccess {
  /** Canonical numeric ad account ID, without the act_ prefix. */
  accountId: string;
  currency: string;
  timezone: string;
  /** Active ad account, explicit ADVERTISE task and live ads_management grant. */
  canAdvertise: boolean;
  permissions: MetaPublishingPermissions;
  pages: MetaPublishingPage[];
  /** False when pages_show_list is absent or the bounded list was truncated. */
  pagesComplete: boolean;
}

const PLATFORM = "meta_ads";
const GRAPH_ORIGIN = "https://graph.facebook.com";
const PAGE_SIZE = 100;
const MAX_PERMISSION_PAGES = 3;
const MAX_ACCOUNT_PAGES = 5;
const DEADLINE_MS = 20_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const ID = /^[1-9][0-9]{0,31}$/;
const CURSOR = /^[A-Za-z0-9_+/-]{1,4096}={0,2}$/;

type RecordValue = Record<string, unknown>;
type Edge = "permissions" | "accounts";

function invalid(): never {
  throw new PaidProviderError(PLATFORM, "invalid_response", false);
}

function record(value: unknown): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as RecordValue;
}

function tasks(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100
    || !value.every((task) => typeof task === "string" && /^[A-Z_]{1,64}$/.test(task))) invalid();
  return value;
}

function timezone(value: unknown): string {
  if (typeof value !== "string" || value.length > 100 || !/^[A-Za-z0-9_+/-]+$/.test(value)) invalid();
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
  } catch {
    invalid();
  }
  return value;
}

function cursor(value: unknown): string {
  if (typeof value !== "string" || !CURSOR.test(value)) invalid();
  return value;
}

/** Never follow a provider URL: validate its origin/edge, then reuse only after. */
function nextCursor(pagingValue: unknown, edge: Edge): string | null {
  if (pagingValue == null) return null;
  const paging = record(pagingValue);
  const cursors = paging.cursors == null ? null : record(paging.cursors);
  if (cursors?.before !== undefined) cursor(cursors.before);
  if (cursors?.after !== undefined) cursor(cursors.after);
  if (paging.next == null) return null;
  if (typeof paging.next !== "string" || paging.next.length > 16_384) invalid();
  let next: URL;
  try { next = new URL(paging.next); } catch { return invalid(); }
  const parts = next.pathname.split("/");
  if (next.origin !== GRAPH_ORIGIN || next.username || next.password || next.port || next.hash
    || parts.length !== 4 || parts[1] !== META_GRAPH_VERSION
    || (parts[2] !== "me" && !ID.test(parts[2])) || parts[3] !== edge
    || next.searchParams.getAll("after").length !== 1) invalid();
  const after = cursor(next.searchParams.get("after"));
  if (cursors?.after !== undefined && cursors.after !== after) invalid();
  return after;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) invalid();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        invalid();
      }
      chunks.push(chunk.value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return invalid();
    }
  } finally {
    reader.releaseLock();
  }
}

function graphError(value: unknown, status: number): PaidProviderError {
  const error = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue : {};
  if (error.code === 190 || error.code === 102) return new PaidProviderError(PLATFORM, "authentication", false);
  if (error.code === 10 || error.code === 200 || error.code === 294) {
    return new PaidProviderError(PLATFORM, "permission", false);
  }
  if (error.code === 4 || error.code === 17 || error.code === 32 || error.code === 613) {
    return new PaidProviderError(PLATFORM, "rate_limit", true);
  }
  return providerHttpError(PLATFORM, status);
}

/** Read-only; callers must authorize the workspace's connection before calling. */
export async function getMetaPublishingAccess(
  connection: Connection,
  fetchImpl: typeof fetch = fetch,
  tokenProvider: ConnectionTokenProvider = getConnectionAccessToken,
): Promise<MetaPublishingAccess> {
  if (connection.platform !== PLATFORM) throw new PaidProviderError(PLATFORM, "not_supported", false);
  if (connection.status !== "connected") throw new PaidProviderError(PLATFORM, "authentication", false);
  const accountId = connection.externalAccountId.replace(/^act_/, "");
  if (!ID.test(accountId)) invalid();

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new PaidProviderError(PLATFORM, "network", true));
    }, DEADLINE_MS);
  });

  async function inspect(): Promise<MetaPublishingAccess> {
    let token: string;
    try {
      token = await tokenProvider(connection, PLATFORM);
    } catch {
      throw new PaidProviderError(PLATFORM, "authentication", false);
    }
    if (typeof token !== "string" || !token || /[\s\x00-\x1f\x7f]/.test(token)) {
      throw new PaidProviderError(PLATFORM, "authentication", false);
    }
    const proof = metaAppSecretProof(token);

    async function get(path: string, fields: string, after?: string): Promise<RecordValue> {
      controller.signal.throwIfAborted();
      const url = new URL(`${GRAPH_ORIGIN}/${META_GRAPH_VERSION}/${path}`);
      url.searchParams.set("fields", fields);
      if (path.startsWith("me/")) url.searchParams.set("limit", String(PAGE_SIZE));
      if (after) url.searchParams.set("after", after);
      if (proof) url.searchParams.set("appsecret_proof", proof);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        throw new PaidProviderError(PLATFORM, "network", true);
      }
      let body: RecordValue;
      try {
        body = record(await readJson(response));
      } catch (error) {
        if (!response.ok) throw providerHttpError(PLATFORM, response.status);
        throw error;
      }
      if (!response.ok || body.error != null) throw graphError(body.error, response.status);
      return body;
    }

    async function list(edge: Edge, fields: string, maxPages: number): Promise<{ rows: RecordValue[]; complete: boolean }> {
      const rows: RecordValue[] = [];
      const seen = new Set<string>();
      let after: string | undefined;
      for (let page = 0; page < maxPages; page += 1) {
        const body = await get(`me/${edge}`, fields, after);
        if (!Array.isArray(body.data) || body.data.length > PAGE_SIZE) invalid();
        rows.push(...body.data.map(record));
        const next = nextCursor(body.paging, edge);
        if (next === null) return { rows, complete: true };
        if (seen.has(next)) throw new PaidProviderError(PLATFORM, "pagination_incomplete", false);
        seen.add(next);
        after = next;
      }
      return { rows, complete: false };
    }

    const permissionRows = await list("permissions", "permission,status", MAX_PERMISSION_PAGES);
    if (!permissionRows.complete) throw new PaidProviderError(PLATFORM, "pagination_incomplete", false);
    const grants = new Map<string, boolean>();
    for (const row of permissionRows.rows) {
      if (typeof row.permission !== "string" || !/^[a-z][a-z0-9_]{0,127}$/.test(row.permission)
        || typeof row.status !== "string" || !["granted", "declined", "expired"].includes(row.status)
        || grants.has(row.permission)) invalid();
      grants.set(row.permission, row.status === "granted");
    }
    const permissions: MetaPublishingPermissions = {
      adsManagement: grants.get("ads_management") === true,
      pagesShowList: grants.get("pages_show_list") === true,
      pagesReadEngagement: grants.get("pages_read_engagement") === true,
    };
    const account = await get(`act_${accountId}`, "id,account_id,account_status,currency,timezone_name,user_tasks");
    if (account.id !== `act_${accountId}` || account.account_id !== accountId
      || typeof account.account_status !== "number" || !Number.isSafeInteger(account.account_status) || account.account_status < 0
      || typeof account.currency !== "string" || !/^[A-Z]{3}$/.test(account.currency)) invalid();
    const accountTasks = tasks(account.user_tasks);
    const accountTimezone = timezone(account.timezone_name);
    const accountPages = permissions.pagesShowList
      ? await list("accounts", "id,name,tasks", MAX_ACCOUNT_PAGES)
      : { rows: [], complete: false };
    const seenPages = new Set<string>();
    const pages: MetaPublishingPage[] = accountPages.rows.map((row) => {
      if (typeof row.id !== "string" || !ID.test(row.id) || seenPages.has(row.id)
        || typeof row.name !== "string" || !row.name.trim() || row.name.length > 512
        || /[\x00-\x1f\x7f]/.test(row.name)) invalid();
      seenPages.add(row.id);
      const pageTasks = tasks(row.tasks);
      return {
        id: row.id,
        name: row.name.trim(),
        canAdvertise: permissions.adsManagement && permissions.pagesShowList && permissions.pagesReadEngagement
          && pageTasks.includes("ADVERTISE"),
      };
    });
    return {
      accountId,
      currency: account.currency,
      timezone: accountTimezone,
      canAdvertise: account.account_status === 1 && accountTasks.includes("ADVERTISE") && permissions.adsManagement,
      permissions,
      pages,
      pagesComplete: accountPages.complete,
    };
  }

  try {
    return await Promise.race([inspect(), deadline]);
  } catch (error) {
    if (error instanceof PaidProviderError) throw new PaidProviderError(PLATFORM, error.code, error.retryable);
    throw new PaidProviderError(PLATFORM, controller.signal.aborted ? "network" : "invalid_response", true);
  } finally {
    clearTimeout(timer);
  }
}
