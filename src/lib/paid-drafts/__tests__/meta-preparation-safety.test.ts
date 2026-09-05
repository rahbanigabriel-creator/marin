import assert from "node:assert/strict";
import test from "node:test";
import type { Connection, Prisma } from "@prisma/client";

import { assetBlobPrefix } from "@/lib/storage/asset-path";
import { metaPausedFixture } from "../__fixtures__/meta-paused";
import { PaidDraftConflictError } from "../errors";
import { createMetaPausedPreparer, type MetaPreparationDependencies } from "../meta-paused-execution";
import { MetaPausedProviderError } from "../meta-paused-provider";
import {
  assertMetaCompletedAssets, assertMetaConnectionGeneration, createMetaPreparationGate,
  metaConnectionGeneration, MetaPreparationDeadline, readMetaPreparedImage,
  type MetaCompletedAsset, type MetaPrivateAssetBlob,
} from "../meta-preparation-safety";

const WORKSPACE = "workspace_1";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1]);

function connection(): Connection {
  return {
    id: "connection_meta", workspaceId: WORKSPACE, platform: "meta_ads", externalAccountId: "123456789",
    encAccessToken: "encrypted-access-test-only", encRefreshToken: null, expiresAt: new Date("2099-01-01"), status: "connected",
    displayName: "Test account", scopes: "ads_management pages_show_list pages_read_engagement", currency: "EUR", timezone: "UTC",
    lastSyncAt: null, lastSuccessfulSyncAt: null, lastErrorCode: null, lastErrorMessage: null,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
  };
}

function asset(): MetaCompletedAsset {
  return { id: "asset_1", kind: "image", mimeType: "image/png", bytes: PNG.length, storageKey: `${assetBlobPrefix(WORKSPACE, "asset_1")}photo.png` };
}

function blob(bytes = PNG, row = asset()): MetaPrivateAssetBlob {
  return {
    statusCode: 200, blob: { pathname: row.storageKey, contentType: row.mimeType, size: row.bytes },
    stream: new ReadableStream<Uint8Array>({ start: (controller) => { controller.enqueue(bytes); controller.close(); } }),
  };
}

function code(expected: string) {
  return (error: unknown) => {
    assert.ok(error instanceof PaidDraftConflictError);
    assert.equal(error.code, expected);
    assert.ok(!error.message.includes("encrypted-access-test-only"));
    return true;
  };
}

function provenNoEffect(error: unknown): boolean {
  assert.ok(error instanceof MetaPausedProviderError);
  assert.equal(error.code, "meta_paused_request_failed");
  assert.equal(error.externalEffectPossible, false);
  return true;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

test("completed assets accept exact private JPEG/PNG objects, not upload or deletion reservations", () => {
  const snapshot = metaPausedFixture();
  assert.doesNotThrow(() => assertMetaCompletedAssets(WORKSPACE, snapshot, [asset()]));
  assert.doesNotThrow(() => assertMetaCompletedAssets(WORKSPACE, snapshot, [{ ...asset(), mimeType: "image/jpeg", bytes: 8 * 1_024 * 1_024 }]));
  for (const storageKey of [
    "marpin:storage-reservation:reservation_1", `marpin:storage-delete:${asset().storageKey}`,
    assetBlobPrefix(WORKSPACE, "asset_1"), `ws/other/asset_1/photo.png`, `ws/${WORKSPACE}/asset_2/photo.png`,
    `https://example.com/${asset().storageKey}`, `${assetBlobPrefix(WORKSPACE, "asset_1")}../photo.png`,
    `${assetBlobPrefix(WORKSPACE, "asset_1")}%2e%2e%2fphoto.png`, `${assetBlobPrefix(WORKSPACE, "asset_1")}..`,
    `${assetBlobPrefix(WORKSPACE, "asset_1")}photo.png?overwrite=true`,
  ]) {
    assert.throws(() => assertMetaCompletedAssets(WORKSPACE, snapshot, [{ ...asset(), storageKey }]), code("meta_asset_unavailable"));
  }
  for (const bytes of [0, -1, 1.5, NaN, Infinity, 8 * 1_024 * 1_024 + 1]) {
    assert.throws(() => assertMetaCompletedAssets(WORKSPACE, snapshot, [{ ...asset(), bytes }]), code("meta_asset_unavailable"));
  }
  for (const mimeType of ["image/jpg", "IMAGE/PNG", "image/png "]) {
    assert.throws(() => assertMetaCompletedAssets(WORKSPACE, snapshot, [{ ...asset(), mimeType }]), code("meta_asset_unavailable"));
  }
  assert.throws(() => assertMetaCompletedAssets(WORKSPACE, snapshot, []));
  assert.throws(() => assertMetaCompletedAssets(WORKSPACE, snapshot, [{ ...asset(), kind: "video" }]));
  assert.throws(() => assertMetaCompletedAssets(WORKSPACE, snapshot, [{ ...asset(), mimeType: "image/webp" }]));
  assert.throws(() => assertMetaCompletedAssets(WORKSPACE, snapshot, [asset(), asset()]), code("meta_asset_unavailable"));
});

test("completed-asset helper is inert for legacy manual-preparation snapshots without Meta delivery", () => {
  const snapshot = metaPausedFixture();
  delete (snapshot as { metaDelivery?: unknown }).metaDelivery;
  assert.doesNotThrow(() => assertMetaCompletedAssets(WORKSPACE, snapshot, []));
});

test("generation binds every server credential field without including incidental sync/display metadata", () => {
  const original = connection();
  const generation = metaConnectionGeneration(original);
  assert.match(generation, /^[a-f0-9]{64}$/);
  assert.equal(metaConnectionGeneration(structuredClone(original)), generation);
  for (const change of [
    { id: "other" }, { workspaceId: "other" }, { platform: "google_ads" }, { externalAccountId: "999" },
    { encAccessToken: "replacement" }, { encRefreshToken: "refresh-replacement" },
    { expiresAt: new Date("2098-01-01") }, { expiresAt: null }, { status: "revoked" },
  ]) assert.notEqual(metaConnectionGeneration({ ...original, ...change }), generation);
  const incidentalChange = { ...original, displayName: "new label", updatedAt: new Date(), lastSyncAt: new Date() };
  assert.equal(metaConnectionGeneration(incidentalChange), generation);
  assert.ok(!generation.includes(original.encAccessToken));
});

test("generation recheck scopes the database read and rejects changed, revoked, expired, deleted or foreign rows", async () => {
  const original = connection();
  const expected = metaConnectionGeneration(original);
  let current: Connection | null = original;
  const db = { connection: { findFirst: async (query: { where: object; select: object }) => {
    assert.deepEqual(query.where, { id: original.id, workspaceId: WORKSPACE });
    assert.deepEqual(Object.keys(query.select).sort(), ["id", "workspaceId", "platform", "externalAccountId", "encAccessToken", "encRefreshToken", "expiresAt", "status"].sort());
    return current;
  } } } as unknown as Pick<Prisma.TransactionClient, "connection">;
  await assertMetaConnectionGeneration(db, original.id, WORKSPACE, expected);
  for (const change of [
    { id: "other" }, { workspaceId: "other" }, { platform: "google_ads" }, { externalAccountId: "999" },
    { encAccessToken: "replacement" }, { encRefreshToken: "replacement" }, { expiresAt: new Date("2098-01-01") },
    { status: "revoked" }, { status: "error" }, { expiresAt: new Date("2020-01-01") },
  ]) {
    current = { ...original, ...change };
    await assert.rejects(assertMetaConnectionGeneration(db, original.id, WORKSPACE, expected), code("meta_connection_changed"));
  }
  current = { ...original, status: "revoked" };
  await assert.rejects(assertMetaConnectionGeneration(db, original.id, WORKSPACE, metaConnectionGeneration(current)), code("meta_connection_changed"));
  current = { ...original, expiresAt: new Date("2020-01-01") };
  await assert.rejects(assertMetaConnectionGeneration(db, original.id, WORKSPACE, metaConnectionGeneration(current)), code("meta_connection_changed"));
  current = null;
  await assert.rejects(assertMetaConnectionGeneration(db, original.id, WORKSPACE, expected), code("meta_connection_changed"));
  await assert.rejects(assertMetaConnectionGeneration(db, original.id, WORKSPACE, "client-supplied"), code("meta_connection_changed"));
});

test("private media read validates metadata, exact length and detected file kind", async () => {
  const deadline = new MetaPreparationDeadline();
  try {
    assert.deepEqual(await readMetaPreparedImage(asset(), blob(), deadline), PNG);
    for (const change of [{ pathname: "foreign/private.png" }, { size: PNG.length + 1 }, { contentType: "image/jpeg" }]) {
      const invalid = blob();
      invalid.blob = { ...invalid.blob, ...change };
      await assert.rejects(readMetaPreparedImage(asset(), invalid, deadline), code("meta_asset_changed"));
    }
    for (const bytes of [PNG.subarray(0, 5), Buffer.concat([PNG, PNG]), Buffer.alloc(PNG.length)]) {
      await assert.rejects(readMetaPreparedImage(asset(), blob(bytes), deadline), code("meta_asset_changed"));
    }
    await assert.rejects(readMetaPreparedImage(asset(), null, deadline), code("meta_asset_unavailable"));
  } finally { deadline.dispose(); }
});

test("hanging stream reads and never-resolving cancel callbacks cannot exceed the deadline", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const deadline = new MetaPreparationDeadline();
  let cancelled = false;
  const hanging = blob();
  hanging.stream = new ReadableStream<Uint8Array>({
    pull: () => new Promise<never>(() => {}),
    cancel: () => { cancelled = true; return new Promise<never>(() => {}); },
  });
  const rejected = assert.rejects(readMetaPreparedImage(asset(), hanging, deadline), code("meta_preparation_timeout"));
  await flush();
  context.mock.timers.tick(45_000);
  await rejected;
  assert.equal(cancelled, true);
  assert.equal(deadline.signal.aborted, true);
  deadline.dispose();
});

test("in-flight preparation coalesces by key, admits at most eight keys, and never caches settled results", async () => {
  const gate = createMetaPreparationGate<number>();
  const pending = deferred<number>();
  let loads = 0;
  const load = async () => { loads += 1; return pending.promise; };
  const first = gate("same", load);
  assert.equal(gate("same", load), first);
  const other = Array.from({ length: 7 }, (_, index) => gate(`other-${index}`, load));
  await assert.rejects(gate("ninth", load), code("meta_preparation_busy"));
  await flush();
  assert.equal(loads, 8);
  pending.resolve(42);
  assert.equal(await first, 42);
  await Promise.all(other);
  assert.equal(await gate("same", async () => { loads += 1; return 77; }), 77);
  assert.equal(loads, 9);
});

test("failed and timed-out preparations release their slots and late completions cannot resume the pipeline", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const gate = createMetaPreparationGate<number>(1);
  const blocked = deferred<number>();
  let continuation = 0;
  const rejected = assert.rejects(gate("timeout", async (deadline) => {
    await deadline.wait(() => blocked.promise);
    continuation += 1;
    return 1;
  }), code("meta_preparation_timeout"));
  await flush();
  context.mock.timers.tick(45_000);
  await rejected;
  assert.equal(await gate("next", async () => 2), 2);
  blocked.resolve(3);
  await flush();
  assert.equal(continuation, 0);
  await assert.rejects(gate("fail", async () => { throw new Error("test failure"); }));
  assert.equal(await gate("after-failure", async () => 4), 4);
});

function preparation() {
  const captured = connection();
  let current = captured;
  const rows = [asset()];
  const events: string[] = [];
  const tokens: string[] = [];
  const dependencies: MetaPreparationDependencies = {
    db: {
      connection: { findFirst: async () => { events.push("connection"); return current; } },
      asset: { findMany: async () => { events.push("assets"); return rows; } },
    } as unknown as MetaPreparationDependencies["db"],
    accessToken: (row) => { events.push("token"); return `decoded-${row.encAccessToken}`; },
    publishingAccess: async (_row, token) => {
      events.push("access"); tokens.push(token);
      return {
        accountId: captured.externalAccountId, currency: "EUR", timezone: "UTC", canAdvertise: true,
        permissions: { adsManagement: true, pagesShowList: true, pagesReadEngagement: true },
        pages: [{ id: "987654321", name: "Test Page", canAdvertise: true }], pagesComplete: true,
      };
    },
    getBlob: async () => { events.push("blob"); return blob(); },
    create: async (input) => {
      events.push("provider"); tokens.push(input.accessToken);
      assert.deepEqual(input.images.get("asset_1"), PNG);
      await input.checkpoint([{ key: "campaign", kind: "campaign", status: "submitting" }]);
      return { campaignId: "999", steps: [] };
    },
    proof: () => null,
  };
  return {
    dependencies, events, tokens, rows,
    input: { workspaceId: WORKSPACE, connection: captured, snapshot: metaPausedFixture(), now: new Date(), preparationKey: "approval_1" },
    replaceConnection: (row: Connection) => { current = row; },
  };
}

test("preparation binds one credential to access and creation, coalesces copies, and is single-use", async () => {
  const { dependencies, input, events, tokens } = preparation();
  const prepare = createMetaPausedPreparer(dependencies);
  const pending = prepare(input);
  const same = prepare(structuredClone(input));
  assert.equal(pending, same);
  input.connection.encAccessToken = "changed-caller-object";
  // The stored row is deliberately a separate snapshot, as Prisma would return it.
  dependencies.db.connection.findFirst = (async () => connection()) as typeof dependencies.db.connection.findFirst;
  const prepared = await pending;
  assert.equal(events.filter((event) => event === "access").length, 1);
  assert.equal(events.filter((event) => event === "token").length, 1);
  assert.equal(events.includes("provider"), false);
  assert.deepEqual(await prepared.run(async () => {}), { campaignId: "999", steps: [] });
  assert.deepEqual(tokens, ["decoded-encrypted-access-test-only", "decoded-encrypted-access-test-only"]);
  await assert.rejects(prepared.run(async () => {}), code("meta_preparation_consumed"));
  assert.equal(events.filter((event) => event === "provider").length, 1);
});

test("connection replacement during preparation fails before provider creation", async () => {
  const { dependencies, input, replaceConnection, events } = preparation();
  const original = dependencies.getBlob;
  dependencies.getBlob = async (...args) => {
    replaceConnection({ ...input.connection, encAccessToken: "replacement" });
    return original(...args);
  };
  await assert.rejects(createMetaPausedPreparer(dependencies)(input), code("meta_connection_changed"));
  assert.equal(events.includes("provider"), false);
});

test("connection revocation after preparation stops run before provider creation", async () => {
  const { dependencies, input, replaceConnection, events } = preparation();
  const prepared = await createMetaPausedPreparer(dependencies)(input);
  replaceConnection({ ...input.connection, status: "revoked" });
  await assert.rejects(prepared.run(async () => {}), provenNoEffect);
  assert.equal(events.includes("provider"), false);
});

test("a pending/deleting asset is rejected before any private download or provider creation", async () => {
  for (const storageKey of ["marpin:storage-reservation:id", `marpin:storage-delete:${asset().storageKey}`]) {
    const { dependencies, input, rows, events } = preparation();
    rows[0].storageKey = storageKey;
    await assert.rejects(createMetaPausedPreparer(dependencies)(input), code("meta_asset_unavailable"));
    assert.equal(events.includes("blob"), false);
    assert.equal(events.includes("provider"), false);
  }
});

test("delayed blob headers abort at 45 seconds; late streams are cancelled and cannot create ads", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { dependencies, input, events } = preparation();
  const late = deferred<MetaPrivateAssetBlob>();
  const requested = deferred<void>();
  let signal: AbortSignal | undefined;
  dependencies.getBlob = async (_key, incoming) => { signal = incoming; requested.resolve(); return late.promise; };
  const rejected = assert.rejects(createMetaPausedPreparer(dependencies)(input), code("meta_preparation_timeout"));
  await requested.promise;
  assert.ok(signal);
  context.mock.timers.tick(45_000);
  await rejected;
  assert.equal(signal.aborted, true);
  let cancelled = false;
  late.resolve({ ...blob(), stream: new ReadableStream<Uint8Array>({ cancel: () => { cancelled = true; } }) });
  await flush();
  assert.equal(cancelled, true);
  assert.equal(events.includes("provider"), false);
});

test("one total deadline spans access and media reads, not a fresh 45 seconds per stage", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { dependencies, input } = preparation();
  const access = dependencies.publishingAccess;
  const release = deferred<void>();
  dependencies.publishingAccess = async (...args) => { await release.promise; return access(...args); };
  dependencies.getBlob = async () => new Promise<never>(() => {});
  const rejected = assert.rejects(createMetaPausedPreparer(dependencies)(input), code("meta_preparation_timeout"));
  await flush();
  context.mock.timers.tick(30_000);
  release.resolve();
  await flush();
  context.mock.timers.tick(15_000);
  await rejected;
});

test("expired prepared results and late startup generation reads cannot start provider writes", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const first = preparation();
  const expired = await createMetaPausedPreparer(first.dependencies)(first.input);
  context.mock.timers.tick(45_000);
  await assert.rejects(expired.run(async () => {}), provenNoEffect);
  assert.equal(first.events.includes("provider"), false);

  const second = preparation();
  const prepared = await createMetaPausedPreparer(second.dependencies)(second.input);
  const generation = deferred<Connection>();
  second.dependencies.db.connection.findFirst = (async () => generation.promise) as typeof second.dependencies.db.connection.findFirst;
  const rejected = assert.rejects(prepared.run(async () => {}), provenNoEffect);
  await flush();
  context.mock.timers.tick(45_000);
  await rejected;
  generation.resolve(second.input.connection);
  await flush();
  assert.equal(second.events.includes("provider"), false);
});

test("different approvals and omitted preparation keys never share single-use prepared results", async () => {
  const { dependencies, input, events } = preparation();
  const prepare = createMetaPausedPreparer(dependencies);
  const first = prepare(input);
  const otherApproval = prepare({ ...input, preparationKey: "approval_2" });
  const unkeyed = prepare({ ...input, preparationKey: undefined });
  const anotherUnkeyed = prepare({ ...input, preparationKey: undefined });
  const results = await Promise.all([first, otherApproval, unkeyed, anotherUnkeyed]);
  assert.equal(new Set(results).size, 4);
  assert.equal(events.filter((event) => event === "token").length, 4);
  for (const result of results) await result.run(async () => {});
  assert.equal(events.filter((event) => event === "provider").length, 4);
});

test("errors from the provider adapter retain their original external-effect classification", async () => {
  for (const providerError of [new Error("unknown provider outcome"), new MetaPausedProviderError("meta_paused_request_timeout", true)]) {
    const { dependencies, input } = preparation();
    dependencies.create = async () => { throw providerError; };
    const prepared = await createMetaPausedPreparer(dependencies)(input);
    await assert.rejects(prepared.run(async () => {}), (error) => error === providerError);
  }
});
