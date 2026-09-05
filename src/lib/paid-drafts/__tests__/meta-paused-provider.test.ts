import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { META_GRAPH_VERSION } from "../../connectors/registry";
import { paidProviderOutcome } from "../dto";
import type { MetaPausedSnapshot } from "../meta-paused-contract";
import {
  MetaPausedProviderError, runMetaPausedCreation, verifyMetaPausedCreation,
  type MetaPausedCreationInput, type MetaPausedStep,
} from "../meta-paused-provider";

const ACCESS_TOKEN = "unit-test-bearer-do-not-use";
const PROOF = "f".repeat(64);
const ACCOUNT_ID = "12345678901234567890123456789012";
const PAGE_ID = "23456789012345678901234567890123";
const IMAGE_BYTES = Buffer.from("unit-test-image-bytes");

function snapshot(adCount = 1): MetaPausedSnapshot {
  const year = new Date().getUTCFullYear() + 1;
  return {
    schemaVersion: 1, source: "manual", platform: "meta_ads", template: "meta_traffic",
    connection: { platform: "meta_ads", connectionId: "connection_1", accountId: ACCOUNT_ID, accountName: "Fitura" },
    campaign: { name: "Fitura traffic - paused", objective: "traffic" },
    budget: { amountMinor: 507, cadence: "daily", currency: "EUR" },
    schedule: {
      startsAt: `${year}-08-10T10:00:00+02:00`, endsAt: `${year}-08-17T10:00:00+02:00`,
      timezone: "Europe/Madrid",
    },
    assumptions: [],
    metaDelivery: {
      version: 1, pageId: PAGE_ID, pageName: "Fitura", placement: "facebook_feed",
      specialAdCategory: "none", beneficiary: "Fitura Beneficiary", payer: "Fitura Payer",
    },
    adGroups: [{
      localId: "group_1", name: "Spain and France", targeting: {
        kind: "audience", locations: ["ES", "FR"], languages: ["All languages"],
        ageMin: 18, ageMax: 65, genders: ["all"], interests: [],
      },
      ads: Array.from({ length: adCount }, (_, index) => ({
        localId: `ad_${index + 1}`, name: `Fitura image ${index + 1}`, format: "image" as const,
        assetIds: [`asset_${index + 1}`] as [string], primaryText: "Build your workout plan.",
        headline: "Train with Fitura", description: index === 1 ? null : "Your training companion.",
        destinationUrl: "https://apps.apple.com/es/app/fitura/id6743079022", callToAction: "learn_more" as const,
      })),
    }],
  };
}

interface Request {
  url: URL;
  method: string;
  params: Record<string, string>;
  init: RequestInit;
}

function graphMock() {
  const requests: Request[] = [];
  const nodes = new Map<string, Record<string, unknown>>();
  let campaignId = "";
  let imageCount = 0;
  let counter = 1_000;
  let override: ((request: Request, response: Record<string, unknown>) => unknown | Promise<unknown>) | undefined;
  const fetchImpl: typeof fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, "https://graph.facebook.com");
    assert.ok(parsed.pathname.startsWith(`/${META_GRAPH_VERSION}/`));
    const request: Request = {
      url: parsed, method: init.method ?? "GET", init,
      params: Object.fromEntries(init.method === "POST" ? new URLSearchParams(String(init.body)) : parsed.searchParams),
    };
    requests.push(request);
    const path = parsed.pathname.slice(`/${META_GRAPH_VERSION}/`.length);
    let result: Record<string, unknown>;
    if (request.method === "POST") {
      assert.match(path, new RegExp(`^act_${ACCOUNT_ID}/(campaigns|adsets|adimages|adcreatives|ads)$`));
      const edge = path.split("/")[1];
      const id = String(++counter);
      result = { id };
      if (edge === "campaigns") {
        campaignId = id;
        nodes.set(id, { id, account_id: ACCOUNT_ID, status: "PAUSED" });
      } else if (edge === "adsets") {
        nodes.set(id, { id, account_id: ACCOUNT_ID, campaign_id: campaignId, status: "PAUSED" });
      } else if (edge === "ads") {
        nodes.set(id, {
          id, account_id: ACCOUNT_ID, campaign_id: campaignId, adset_id: request.params.adset_id,
          status: "PAUSED", creative: { id: JSON.parse(request.params.creative).creative_id },
        });
      } else if (edge === "adimages") {
        result = { images: { bytes: { hash: (++imageCount).toString(16).padStart(32, "0") } } };
      }
    } else if (path === `act_${ACCOUNT_ID}`) {
      result = { id: path, account_id: ACCOUNT_ID, currency: "EUR" };
    } else {
      assert.equal(request.method, "GET");
      assert.ok(nodes.has(path), `Unexpected read: ${path}`);
      result = structuredClone(nodes.get(path)!);
    }
    const response = override ? await override(request, result) : result;
    return response instanceof Response ? response : Response.json(response);
  };
  return {
    fetchImpl, requests, nodes,
    override: (fn: NonNullable<typeof override>) => { override = fn; },
    posts: () => requests.filter((request) => request.method === "POST"),
  };
}

function setup(adCount = 1) {
  const approved = snapshot(adCount);
  const mock = graphMock();
  const checkpoints: MetaPausedStep[][] = [];
  const options: MetaPausedCreationInput = {
    snapshot: approved, accessToken: ACCESS_TOKEN, appSecretProof: PROOF, fetchImpl: mock.fetchImpl,
    images: new Map(approved.adGroups[0].ads.map((ad) => [ad.assetIds[0], IMAGE_BYTES])),
    checkpoint: async (steps) => { checkpoints.push(structuredClone(steps)); },
  };
  return { options, mock, checkpoints };
}

function errorIs(code: string, externalEffectPossible: boolean) {
  return (error: unknown) => {
    assert.ok(error instanceof MetaPausedProviderError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.equal(error.externalEffectPossible, externalEffectPossible);
    assert.equal(error.cause, undefined);
    assert.ok(!JSON.stringify(error).includes(ACCESS_TOKEN));
    assert.ok(!String(error.stack).includes(ACCESS_TOKEN));
    assert.ok(!JSON.stringify(error).includes(PROOF));
    return true;
  };
}

function acknowledgedErrorIs(code: string, externalEffectPossible: boolean, expected: MetaPausedStep[]) {
  return (error: unknown) => {
    errorIs(code, externalEffectPossible)(error);
    assert.ok(error instanceof MetaPausedProviderError);
    assert.deepEqual(error.acknowledgedSteps, expected);
    assert.ok(Object.isFrozen(error.acknowledgedSteps));
    for (const step of error.acknowledgedSteps!) assert.ok(Object.isFrozen(step));
    assert.ok(!JSON.stringify(error.acknowledgedSteps).includes(ACCESS_TOKEN));
    assert.ok(!JSON.stringify(error.acknowledgedSteps).includes(PROOF));
    return true;
  };
}

test("creates the complete Meta tree paused with exact budget, identity, targeting, dates and image bytes", async () => {
  const { options, mock, checkpoints } = setup(3);
  const approved = options.snapshot;
  const outcome = await runMetaPausedCreation(options);
  const posts = mock.posts();
  assert.equal(posts.length, 11);
  assert.equal(mock.requests.length, 17); // Account preflight and campaign/adset/three-ad read-back.
  assert.equal(outcome.steps.length, 11);
  assert.deepEqual(outcome.steps, checkpoints.at(-1));
  assert.equal(checkpoints.length, posts.length * 2);
  for (const request of mock.requests) {
    assert.equal(request.init.redirect, "error");
    assert.ok(request.init.signal instanceof AbortSignal);
    assert.equal(new Headers(request.init.headers).get("Authorization"), `Bearer ${ACCESS_TOKEN}`);
    assert.equal(request.params.appsecret_proof, PROOF);
    assert.ok(!request.url.toString().includes(ACCESS_TOKEN));
    assert.equal(request.params.access_token, undefined);
  }
  for (let index = 0; index < posts.length; index += 1) {
    const before = checkpoints[index * 2];
    const after = checkpoints[index * 2 + 1];
    assert.equal(before.length, index + 1);
    assert.equal(before.at(-1)!.status, "submitting");
    assert.equal(before.at(-1)!.id, undefined);
    assert.equal(after.at(-1)!.status, "created");
    assert.ok(after.at(-1)!.id);
    assert.deepEqual(before.slice(0, -1), after.slice(0, -1));
  }
  const campaign = posts.find((request) => request.url.pathname.endsWith("/campaigns"))!.params;
  assert.deepEqual(campaign, {
    name: approved.campaign.name, objective: "OUTCOME_TRAFFIC", status: "PAUSED",
    special_ad_categories: "[]", buying_type: "AUCTION", is_adset_budget_sharing_enabled: "false", appsecret_proof: PROOF,
  });
  const adsets = posts.filter((request) => request.url.pathname.endsWith("/adsets"));
  assert.equal(adsets.length, 1);
  const adset = adsets[0].params;
  assert.equal(adset.daily_budget, "507");
  assert.equal(adset.lifetime_budget, undefined);
  assert.equal(adset.campaign_id, outcome.campaignId);
  assert.equal(adset.name, approved.adGroups[0].name);
  assert.equal(adset.start_time, approved.schedule.startsAt);
  assert.equal(adset.end_time, approved.schedule.endsAt);
  assert.equal(adset.billing_event, "IMPRESSIONS");
  assert.equal(adset.optimization_goal, "LINK_CLICKS");
  assert.equal(adset.bid_strategy, "LOWEST_COST_WITHOUT_CAP");
  assert.equal(adset.destination_type, "WEBSITE");
  assert.equal(adset.dsa_beneficiary, approved.metaDelivery.beneficiary);
  assert.equal(adset.dsa_payor, approved.metaDelivery.payer);
  assert.equal(adset.dsa_payer, undefined);
  assert.deepEqual(JSON.parse(adset.targeting), {
    geo_locations: { countries: ["ES", "FR"] }, age_min: 18, age_max: 65,
    publisher_platforms: ["facebook"], facebook_positions: ["feed"],
  });
  const imagePosts = posts.filter((request) => request.url.pathname.endsWith("/adimages"));
  for (const request of imagePosts) assert.equal(request.params.bytes, IMAGE_BYTES.toString("base64"));
  const creatives = posts.filter((request) => request.url.pathname.endsWith("/adcreatives"));
  for (let index = 0; index < creatives.length; index += 1) {
    const ad = approved.adGroups[0].ads[index];
    const story = JSON.parse(creatives[index].params.object_story_spec);
    assert.equal(creatives[index].params.name, ad.name);
    assert.deepEqual(story, {
      page_id: PAGE_ID, link_data: {
        image_hash: (index + 1).toString(16).padStart(32, "0"), link: ad.destinationUrl,
        message: ad.primaryText, name: ad.headline,
        ...(ad.description === null ? {} : { description: ad.description }),
        call_to_action: { type: "LEARN_MORE", value: { link: ad.destinationUrl } },
      },
    });
  }
  // Images and creatives are non-serving resources; every serving object is explicitly PAUSED.
  for (const request of posts.filter((entry) => /\/(campaigns|adsets|ads)$/.test(entry.url.pathname))) {
    assert.equal(request.params.status, "PAUSED");
  }
  assert.ok(!JSON.stringify(posts.map((entry) => entry.params)).includes("ACTIVE"));
  assert.ok(!JSON.stringify(outcome).includes(ACCESS_TOKEN));
  assert.ok(!JSON.stringify(checkpoints).includes(PROOF));
});

test("uses the exact single lifetime budget and gender mapping without multiplying by the ad count", async () => {
  const { options, mock } = setup(3);
  options.snapshot = {
    ...options.snapshot, budget: { ...options.snapshot.budget, cadence: "lifetime", amountMinor: 12345 },
    adGroups: [{ ...options.snapshot.adGroups[0], targeting: { ...options.snapshot.adGroups[0].targeting, genders: ["female", "male"] } }],
  };
  options.appSecretProof = null;
  await runMetaPausedCreation(options);
  const adset = mock.posts().find((request) => request.url.pathname.endsWith("/adsets"))!.params;
  assert.equal(adset.lifetime_budget, "12345");
  assert.equal(adset.daily_budget, undefined);
  assert.deepEqual(JSON.parse(adset.targeting).genders, [2, 1]);
  for (const request of mock.requests) assert.equal(request.params.appsecret_proof, undefined);
});

test("uploads a shared asset once, with a separate creative and paused ad per approved ad", async () => {
  const { options, mock } = setup(2);
  options.snapshot = {
    ...options.snapshot,
    adGroups: [{ ...options.snapshot.adGroups[0], ads: options.snapshot.adGroups[0].ads.map((ad) => ({ ...ad, assetIds: ["asset_1"] })) }],
  };
  const result = await runMetaPausedCreation(options);
  assert.equal(mock.posts().filter((request) => request.url.pathname.endsWith("/adimages")).length, 1);
  assert.equal(result.steps.length, 7);
});

for (let failAt = 1; failAt <= 10; failAt += 1) {
  test(`checkpoint failure ${failAt} stops all subsequent writes and sanitizes the failure`, async () => {
    const { options, mock } = setup();
    let count = 0;
    let lastSteps: MetaPausedStep[] = [];
    options.checkpoint = async (steps) => {
      lastSteps = structuredClone(steps);
      if (++count === failAt) throw new Error(`Cannot persist ${ACCESS_TOKEN} ${PROOF}`);
    };
    const written = Math.floor(failAt / 2);
    await assert.rejects(runMetaPausedCreation(options), (error) => {
      acknowledgedErrorIs("meta_paused_checkpoint_failed", written > 0, lastSteps)(error);
      assert.equal(lastSteps.filter((step) => step.status === "created").length, written);
      assert.equal(lastSteps.length, Math.ceil(failAt / 2));
      return true;
    });
    assert.equal(mock.posts().length, written);
    assert.equal(count, failAt);
  });
}

test("an ID returned by POST survives a failed checkpoint as an immutable engine-only copy", async () => {
  const { options, mock } = setup();
  const expected: MetaPausedStep[] = [{ key: "campaign", kind: "campaign", status: "created", id: "1001" }];
  let callbackSteps: MetaPausedStep[] | undefined;
  options.checkpoint = async (steps) => {
    if (steps[0].status !== "created") return;
    callbackSteps = steps;
    steps[0].id = ACCESS_TOKEN;
    const fakeError = new MetaPausedProviderError("meta_paused_request_failed", false);
    Object.defineProperty(fakeError, "acknowledgedSteps", { value: [{ ...steps[0], accessToken: ACCESS_TOKEN, proof: PROOF }] });
    throw fakeError;
  };
  await assert.rejects(runMetaPausedCreation(options), (error) => {
    acknowledgedErrorIs("meta_paused_checkpoint_failed", true, expected)(error);
    assert.ok(error instanceof MetaPausedProviderError);
    const retained = error.acknowledgedSteps!;
    assert.notEqual(retained, callbackSteps);
    assert.notEqual(retained[0], callbackSteps![0]);
    assert.equal(Reflect.set(retained[0], "id", "9999"), false);
    assert.equal(Reflect.set(retained, "0", { ...expected[0], id: "9999" }), false);
    assert.equal(Reflect.set(error, "acknowledgedSteps", []), false);
    assert.throws(() => retained.push(expected[0]), TypeError);
    callbackSteps!.splice(0);
    assert.deepEqual(error.acknowledgedSteps, expected);
    return true;
  });
  assert.equal(mock.posts().length, 1);
});

for (const source of ["body", "exception"] as const) {
  test(`untrusted provider ${source} cannot replace known IDs or claim a submitted write had no effect`, async () => {
    const { options, mock } = setup();
    mock.override((request, response) => {
      if (!request.url.pathname.endsWith("/adsets")) return response;
      const forged = [{ key: ACCESS_TOKEN, kind: "ad", status: "created", id: PROOF }];
      if (source === "exception") {
        const error = new MetaPausedProviderError("meta_paused_provider_rejected", false);
        Object.defineProperty(error, "acknowledgedSteps", { value: forged });
        throw error;
      }
      return { error: { message: ACCESS_TOKEN }, acknowledgedSteps: forged, externalEffectPossible: false };
    });
    await assert.rejects(runMetaPausedCreation(options), acknowledgedErrorIs("meta_paused_provider_rejected", true, [
      { key: "campaign", kind: "campaign", status: "created", id: "1001" },
      { key: "adset", kind: "adset", status: "submitting" },
    ]));
    assert.equal(mock.posts().length, 2);
  });
}

test("checkpoint arguments and caller mutations cannot change the approved payload or uploaded bytes", async () => {
  const { options, mock } = setup();
  const originalName = options.snapshot.campaign.name;
  const buffer = Buffer.from(IMAGE_BYTES);
  options.images = new Map([["asset_1", buffer]]);
  options.checkpoint = async (steps) => {
    (options.snapshot.campaign as { name: string }).name = "Changed after approval";
    (options.snapshot.metaDelivery as { pageId: string }).pageId = "999";
    buffer.fill(0);
    steps.splice(0, steps.length);
  };
  const result = await runMetaPausedCreation(options);
  assert.equal(result.steps.length, 5);
  assert.equal(mock.posts()[0].params.name, originalName);
  const story = JSON.parse(mock.posts().find((request) => request.url.pathname.endsWith("/adcreatives"))!.params.object_story_spec);
  assert.equal(story.page_id, PAGE_ID);
  assert.equal(mock.posts().find((request) => request.url.pathname.endsWith("/adimages"))!.params.bytes, IMAGE_BYTES.toString("base64"));
});

test("POST timeout is bounded to ten seconds and never retries even if fetch ignores abort", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { options, mock, checkpoints } = setup();
  let started: (() => void) | undefined;
  const submitting = new Promise<void>((resolve) => { started = resolve; });
  mock.override((request, response) => {
    if (request.method !== "POST") return response;
    started!();
    return new Promise<never>(() => {});
  });
  const operation = runMetaPausedCreation(options);
  const rejected = assert.rejects(operation, acknowledgedErrorIs("meta_paused_request_timeout", true, [
    { key: "campaign", kind: "campaign", status: "submitting" },
  ]));
  await submitting;
  context.mock.timers.tick(9_999);
  assert.equal(mock.posts()[0].init.signal!.aborted, false);
  context.mock.timers.tick(1);
  await rejected;
  assert.equal(mock.posts()[0].init.signal!.aborted, true);
  assert.equal(mock.posts().length, 1);
  assert.deepEqual(checkpoints, [[{ key: "campaign", kind: "campaign", status: "submitting" }]]);
});

test("response-body timeout is bounded too, not just receipt of HTTP headers", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { options, mock } = setup();
  let started: (() => void) | undefined;
  const reading = new Promise<void>((resolve) => { started = resolve; });
  mock.override((request, response) => {
    if (request.method !== "POST") return response;
    return new Response(new ReadableStream<Uint8Array>({
      pull: () => { started!(); return new Promise<never>(() => {}); },
    }));
  });
  const rejected = assert.rejects(runMetaPausedCreation(options), errorIs("meta_paused_request_timeout", true));
  await reading;
  context.mock.timers.tick(10_000);
  await rejected;
  assert.equal(mock.posts().length, 1);
});

test("a later POST timeout retains prior IDs and stays uncertain even if the provider eventually responds", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { options, mock } = setup();
  let started!: () => void;
  let complete!: (response: Record<string, unknown>) => void;
  const submitting = new Promise<void>((resolve) => { started = resolve; });
  const delayedResponse = new Promise<Record<string, unknown>>((resolve) => { complete = resolve; });
  mock.override((request, response) => {
    if (!request.url.pathname.endsWith("/adsets")) return response;
    started();
    return delayedResponse;
  });
  let failure: MetaPausedProviderError | undefined;
  const expected: MetaPausedStep[] = [
    { key: "campaign", kind: "campaign", status: "created", id: "1001" },
    { key: "adset", kind: "adset", status: "submitting" },
  ];
  const rejected = assert.rejects(runMetaPausedCreation(options), (error) => {
    acknowledgedErrorIs("meta_paused_request_timeout", true, expected)(error);
    assert.ok(error instanceof MetaPausedProviderError);
    failure = error;
    return true;
  });
  await submitting;
  context.mock.timers.tick(10_000);
  await rejected;
  complete({ id: "1002" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(failure!.acknowledgedSteps, expected);
  assert.equal(failure!.externalEffectPossible, true);
  assert.equal(mock.posts().length, 2);
});

for (const failure of ["network", "http", "provider", "json", "redirect"] as const) {
  test(`${failure} errors are sanitized and never retried`, async () => {
    const { options, mock } = setup();
    mock.override((request, response) => {
      if (request.method !== "POST") return response;
      if (failure === "network" || failure === "redirect") throw new Error(`Failed ${ACCESS_TOKEN} ${PROOF}`);
      if (failure === "json") return new Response(`invalid JSON ${ACCESS_TOKEN}`);
      if (failure === "http") return new Response(`${ACCESS_TOKEN} ${PROOF}`, { status: 429 });
      return { error: { code: 190, message: `${ACCESS_TOKEN} ${PROOF}` } };
    });
    const code = failure === "network" || failure === "redirect" ? "meta_paused_request_failed"
      : failure === "json" ? "meta_paused_response_invalid" : "meta_paused_provider_rejected";
    await assert.rejects(runMetaPausedCreation(options), errorIs(code, true));
    assert.equal(mock.posts().length, 1);
  });
}

for (const field of ["id", "account_id", "currency"] as const) {
  test(`account preflight rejects ${field} mismatch without writing`, async () => {
    const { options, mock, checkpoints } = setup();
    mock.override((request, response) => request.url.pathname.endsWith(`/act_${ACCOUNT_ID}`)
      ? { ...response, [field]: "mismatch" } : response);
    await assert.rejects(runMetaPausedCreation(options), errorIs("meta_paused_account_mismatch", false));
    assert.equal(mock.posts().length, 0);
    assert.equal(checkpoints.length, 0);
  });
}

for (const invalidId of ["", "1/ads", "https://example.com", "act_123", "1e4", "9".repeat(33), 123, null]) {
  test(`rejects malformed returned Graph ID ${JSON.stringify(invalidId)} before any subsequent write`, async () => {
    const { options, mock } = setup();
    mock.override((request, response) => request.method === "POST" ? { id: invalidId } : response);
    await assert.rejects(runMetaPausedCreation(options), errorIs("meta_paused_response_invalid", true));
    assert.equal(mock.posts().length, 1);
  });
}

for (const images of [null, {}, { a: { hash: "x".repeat(32) } }, { a: { hash: "a".repeat(31) } }, { a: { hash: "a".repeat(32) }, b: { hash: "b".repeat(32) } }]) {
  test(`rejects malformed or ambiguous image response ${JSON.stringify(images)}`, async () => {
    const { options, mock } = setup();
    mock.override((request, response) => request.url.pathname.endsWith("/adimages") ? { images } : response);
    await assert.rejects(runMetaPausedCreation(options), errorIs("meta_paused_response_invalid", true));
    assert.equal(mock.posts().length, 3);
  });
}

test("duplicate returned object IDs stop before image or ad creation", async () => {
  const { options, mock } = setup();
  mock.override((request, response) => request.url.pathname.endsWith("/adsets") ? { id: "1001" } : response);
  await assert.rejects(runMetaPausedCreation(options), acknowledgedErrorIs("meta_paused_duplicate_id", true, [
    { key: "campaign", kind: "campaign", status: "created", id: "1001" },
    { key: "adset", kind: "adset", status: "submitting", id: "1001" },
  ]));
  assert.equal(mock.posts().length, 2);
});

test("Meta-deduplicated image hashes across distinct assets succeed and remain verifiable", async () => {
  const { options, mock } = setup(2);
  mock.override((request, response) => request.url.pathname.endsWith("/adimages")
    ? { images: { bytes: { hash: "a".repeat(32) } } } : response);
  const result = await runMetaPausedCreation(options);
  assert.equal(mock.posts().length, 8);
  assert.deepEqual(result.steps.filter((step) => step.kind === "image").map((step) => step.id), ["a".repeat(32), "a".repeat(32)]);
  assert.deepEqual(await verifyMetaPausedCreation({ ...options, steps: result.steps }), result);
});

test("act_-prefixed account IDs preserve the approved identity while using the same numeric account", async () => {
  const { options, mock } = setup();
  options.snapshot = {
    ...options.snapshot, connection: { ...options.snapshot.connection, accountId: `act_${ACCOUNT_ID}` },
  };
  const result = await runMetaPausedCreation(options);
  assert.equal(options.snapshot.connection.accountId, `act_${ACCOUNT_ID}`);
  assert.deepEqual(await verifyMetaPausedCreation({ ...options, steps: result.steps }), result);
  assert.ok(mock.posts().every((request) => request.url.pathname.startsWith(`/${META_GRAPH_VERSION}/act_${ACCOUNT_ID}/`)));
  assert.ok(mock.requests.every((request) => !request.url.toString().includes("act_act_")));
});

for (const contentLength of [undefined, "12", String(256 * 1_024 + 1)]) {
  test(`response bodies are bounded at 256KB with content-length=${contentLength}`, async () => {
    const { options, mock } = setup();
    let cancelled = false;
    mock.override((request, response) => {
      if (request.method !== "POST") return response;
      return new Response(new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(new Uint8Array(128 * 1_024));
          controller.enqueue(new Uint8Array(128 * 1_024 + 1));
        },
        cancel: () => { cancelled = true; },
      }), { headers: contentLength ? { "Content-Length": contentLength } : {} });
    });
    await assert.rejects(runMetaPausedCreation(options), errorIs("meta_paused_response_too_large", true));
    assert.equal(mock.posts().length, 1);
    assert.equal(cancelled, true);
    assert.equal(mock.posts()[0].init.signal!.aborted, true);
  });
}

test("a valid JSON response of exactly 256KB remains within the bound", async () => {
  const { options, mock } = setup();
  mock.override((request, response) => {
    if (request.method !== "POST") return response;
    const text = JSON.stringify(response);
    const padding = " ".repeat(256 * 1_024 - Buffer.byteLength(text));
    return new Response(text + padding);
  });
  const result = await runMetaPausedCreation(options);
  assert.equal(result.steps.length, 5);
});

for (const [kind, field, value] of [
  ["campaign", "status", "ACTIVE"], ["adset", "status", "CAMPAIGN_PAUSED"], ["ad", "status", "UNKNOWN"],
  ["campaign", "status", undefined], ["campaign", "id", "999"], ["adset", "account_id", "999"],
  ["ad", "account_id", Number(ACCOUNT_ID)], ["adset", "campaign_id", "999"], ["ad", "campaign_id", "999"],
  ["ad", "adset_id", "999"], ["ad", "creative", { id: "999" }], ["ad", "creative", null],
] as const) {
  test(`read-back rejects ${kind} ${field}=${JSON.stringify(value)} and never claims success`, async () => {
    const { options, mock, checkpoints } = setup();
    mock.override((request, response) => {
      if (request.method !== "GET" || request.url.pathname.includes("/act_")) return response;
      const matches = kind === "ad" ? Object.hasOwn(response, "adset_id")
        : kind === "adset" ? Object.hasOwn(response, "campaign_id") && !Object.hasOwn(response, "adset_id")
          : !Object.hasOwn(response, "campaign_id");
      return matches ? { ...response, [field]: value } : response;
    });
    await assert.rejects(runMetaPausedCreation(options), (error) =>
      acknowledgedErrorIs("meta_paused_verification_mismatch", true, checkpoints.at(-1)!)(error));
    assert.equal(mock.posts().length, 5);
  });
}

test("verification is read-only, allows later reconciliation, and requires all child ads", async () => {
  const { options, mock } = setup(3);
  const result = await runMetaPausedCreation(options);
  const requestCount = mock.requests.length;
  const pastSnapshot = {
    ...options.snapshot,
    schedule: { ...options.snapshot.schedule, startsAt: "2020-01-01T00:00:00+01:00", endsAt: "2020-02-01T00:00:00+01:00" },
  };
  assert.deepEqual(await verifyMetaPausedCreation({ ...options, snapshot: pastSnapshot, steps: result.steps }), result);
  const reads = mock.requests.slice(requestCount);
  assert.equal(reads.length, 5);
  assert.ok(reads.every((request) => request.method === "GET"));
  assert.deepEqual(reads.map((request) => request.url.pathname.split("/").at(-1)),
    result.steps.filter((step) => ["campaign", "adset", "ad"].includes(step.kind)).map((step) => step.id));
});

test("read-only verification errors retain a sanitized copy of validated prior steps", async () => {
  const { options, mock } = setup();
  const result = await runMetaPausedCreation(options);
  const expected = structuredClone(result.steps);
  const supplied = result.steps.map((step) => ({ ...step, accessToken: ACCESS_TOKEN, proof: PROOF }));
  const requestCount = mock.requests.length;
  mock.override(() => {
    supplied[0].id = "9999";
    return { error: { message: ACCESS_TOKEN }, acknowledgedSteps: supplied };
  });
  await assert.rejects(verifyMetaPausedCreation({ ...options, steps: supplied }),
    acknowledgedErrorIs("meta_paused_provider_rejected", true, expected));
  assert.ok(mock.requests.slice(requestCount).every((request) => request.method === "GET"));
  await assert.rejects(verifyMetaPausedCreation({ ...options, accessToken: "", steps: expected }),
    acknowledgedErrorIs("meta_paused_invalid_credentials", true, expected));
});

test("engine-generated maximum-length dotted keys survive DTO serialization with every prior ID", async () => {
  const { options } = setup();
  const localId = "a._:-".repeat(38) + "Z";
  const assetId = "asset." + "x".repeat(185);
  assert.equal(localId.length, 191);
  assert.equal(assetId.length, 191);
  const group = options.snapshot.adGroups[0];
  options.snapshot = {
    ...options.snapshot,
    adGroups: [{ ...group, ads: [{ ...group.ads[0], localId, assetIds: [assetId] }] }],
  };
  options.images = new Map([[assetId, IMAGE_BYTES]]);
  const result = await runMetaPausedCreation(options);
  assert.equal(result.steps.find((step) => step.kind === "creative")!.key.length, 200);
  const stored = { kind: "meta_paused_creation", providerSideEffect: "paused_objects", ...result, message: "Verified paused" };
  assert.deepEqual(paidProviderOutcome(stored), stored);
});

for (const mode of ["missing", "submitting", "extra", "duplicate", "malformed", "reordered", "key", "kind"] as const) {
  test(`read-only verification rejects ${mode} checkpoints before requesting any provider resource`, async () => {
    const { options, mock } = setup();
    const result = await runMetaPausedCreation(options);
    const steps = structuredClone(result.steps);
    if (mode === "missing") steps.pop();
    if (mode === "submitting") steps[0].status = "submitting";
    if (mode === "extra") steps.push(steps[0]);
    if (mode === "duplicate") steps[1].id = steps[0].id;
    if (mode === "malformed") steps[0].id = "1/ads";
    if (mode === "reordered") steps.reverse();
    if (mode === "key") steps[0].key = "unexpected";
    if (mode === "kind") steps[0].kind = "ad";
    const count = mock.requests.length;
    await assert.rejects(verifyMetaPausedCreation({ ...options, steps }), (error) => {
      errorIs(mode === "duplicate" ? "meta_paused_duplicate_id" : "meta_paused_verification_incomplete", true)(error);
      assert.ok(error instanceof MetaPausedProviderError);
      assert.equal(error.acknowledgedSteps, undefined);
      return true;
    });
    assert.equal(mock.requests.length, count);
  });
}

test("preflight validates credentials and every approved image before network access", async () => {
  for (const change of [
    { accessToken: "" }, { accessToken: "invalid\r\ntoken" }, { appSecretProof: "not-a-proof" },
    { images: new Map() }, { images: new Map([["asset_1", Buffer.alloc(0)]]) },
  ]) {
    const { options, mock } = setup();
    Object.assign(options, change);
    await assert.rejects(runMetaPausedCreation(options), errorIs("images" in change ? "meta_paused_missing_image" : "meta_paused_invalid_credentials", false));
    assert.equal(mock.requests.length, 0);
  }
});

test("unsupported delivery, format, currency, targeting, amount and schedule fail closed", async () => {
  const original = snapshot();
  const group = original.adGroups[0];
  const changes: MetaPausedSnapshot[] = [
    { ...original, template: "meta_lead" },
    { ...original, campaign: { ...original.campaign, objective: "leads" } },
    { ...original, metaDelivery: { ...original.metaDelivery, beneficiary: "" } },
    { ...original, metaDelivery: { ...original.metaDelivery, payer: " " } },
    { ...original, metaDelivery: { ...original.metaDelivery, pageId: "https://example.com" } },
    { ...original, budget: { ...original.budget, currency: "JPY" } },
    { ...original, budget: { ...original.budget, amountMinor: 5.5 } },
    { ...original, budget: { ...original.budget, amountMinor: 0 } },
    { ...original, adGroups: [] }, { ...original, adGroups: [group, group] },
    { ...original, adGroups: [{ ...group, ads: [] }] },
    { ...original, adGroups: [{ ...group, ads: [{ ...group.ads[0], format: "video" }] }] },
    { ...original, adGroups: [{ ...group, targeting: { ...group.targeting, locations: ["Spain"] } }] },
    { ...original, adGroups: [{ ...group, targeting: { ...group.targeting, locations: [] } }] },
    { ...original, adGroups: [{ ...group, targeting: { ...group.targeting, languages: ["Spanish"] } }] },
    { ...original, adGroups: [{ ...group, targeting: { ...group.targeting, interests: ["fitness"] } }] },
    { ...original, adGroups: [{ ...group, targeting: { ...group.targeting, ageMin: 17 } }] },
    { ...original, adGroups: [{ ...group, targeting: { ...group.targeting, ageMax: 66 } }] },
    { ...original, adGroups: [{ ...group, targeting: { ...group.targeting, genders: ["all", "male"] } }] },
    { ...original, adGroups: [{ ...group, ads: [{ ...group.ads[0], destinationUrl: "javascript:alert(1)" }] }] },
    { ...original, schedule: { ...original.schedule, endsAt: original.schedule.startsAt } },
    { ...original, schedule: { ...original.schedule, timezone: "not-a-zone" } },
  ];
  for (const invalid of changes) {
    const { options, mock } = setup();
    options.snapshot = invalid;
    await assert.rejects(runMetaPausedCreation(options), errorIs("meta_paused_invalid_snapshot", false));
    await assert.rejects(verifyMetaPausedCreation({ ...options, steps: [] }), errorIs("meta_paused_invalid_snapshot", true));
    assert.equal(mock.requests.length, 0);
  }
  const { options, mock } = setup();
  options.snapshot = { ...original, schedule: { ...original.schedule, startsAt: "2020-01-01T00:00:00Z" } };
  await assert.rejects(runMetaPausedCreation(options), errorIs("meta_paused_invalid_snapshot", false));
  assert.equal(mock.requests.length, 0);
});

test("the error type does not expose arbitrary provider text supplied as an error code", () => {
  const error = new MetaPausedProviderError(`Provider says ${ACCESS_TOKEN} ${PROOF}`, true);
  assert.equal(error.code, "meta_paused_request_failed");
  assert.equal(error.acknowledgedSteps, undefined);
  assert.ok(!JSON.stringify(error).includes(ACCESS_TOKEN));
  assert.ok(!error.stack?.includes(PROOF));
});
