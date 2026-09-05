import { Buffer } from "node:buffer";

import { META_GRAPH_VERSION } from "../connectors/registry";
import { assertMetaPausedSnapshot, type MetaPausedSnapshot } from "./meta-paused-contract";
import type { SocialCallToAction } from "./types";
import { parsePaidCampaignSnapshotV1 } from "./validation";

export interface MetaPausedStep {
  key: string;
  kind: "campaign" | "image" | "adset" | "creative" | "ad";
  status: "submitting" | "created";
  /** Image steps contain an image hash; all other steps contain numeric Graph IDs. */
  id?: string;
}

export interface MetaPausedCreationOutcome {
  campaignId: string;
  steps: MetaPausedStep[];
}

export interface MetaPausedProviderInput {
  snapshot: MetaPausedSnapshot;
  accessToken: string;
  appSecretProof: string | null;
  fetchImpl?: typeof fetch;
}

export interface MetaPausedCreationInput extends MetaPausedProviderInput {
  images: ReadonlyMap<string, Buffer>;
  checkpoint: (steps: MetaPausedStep[]) => Promise<void>;
}

export interface MetaPausedVerificationInput extends MetaPausedProviderInput {
  steps: readonly MetaPausedStep[];
}

const ERROR_CODES = new Set([
  "meta_paused_invalid_snapshot", "meta_paused_invalid_credentials",
  "meta_paused_missing_image", "meta_paused_checkpoint_failed",
  "meta_paused_request_timeout", "meta_paused_request_failed",
  "meta_paused_provider_rejected", "meta_paused_response_invalid",
  "meta_paused_response_too_large",
  "meta_paused_duplicate_id", "meta_paused_account_mismatch",
  "meta_paused_verification_incomplete", "meta_paused_verification_mismatch",
]);

/** Deliberately never retains provider bodies, exception causes, tokens, or request URLs. */
export class MetaPausedProviderError extends Error {
  readonly code: string;
  readonly externalEffectPossible: boolean;

  constructor(code: string, externalEffectPossible: boolean) {
    const sanitized = ERROR_CODES.has(code) ? code : "meta_paused_request_failed";
    super(sanitized);
    this.name = "MetaPausedProviderError";
    this.code = sanitized;
    this.externalEffectPossible = externalEffectPossible;
  }

  get acknowledgedSteps(): MetaPausedStep[] | undefined {
    return acknowledgedStepsByError.get(this);
  }
}

const acknowledgedStepsByError = new WeakMap<MetaPausedProviderError, MetaPausedStep[]>();
const GRAPH_ID = /^\d{1,32}$/;
const IMAGE_HASH = /^[a-fA-F0-9]{32}$/;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1_024;
const CTA: Record<SocialCallToAction, string> = {
  contact_us: "CONTACT_US", download: "DOWNLOAD", learn_more: "LEARN_MORE",
  shop_now: "SHOP_NOW", sign_up: "SIGN_UP",
};

type JsonObject = Record<string, unknown>;
type StepDefinition = Pick<MetaPausedStep, "key" | "kind">;

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function graphId(value: unknown): value is string {
  return typeof value === "string" && GRAPH_ID.test(value);
}

function numericAccountId(value: unknown): string | null {
  return typeof value === "string" ? /^(?:act_)?(\d{1,32})$/.exec(value)?.[1] ?? null : null;
}

function copySteps(steps: readonly MetaPausedStep[]): MetaPausedStep[] {
  return steps.map(({ key, kind, status, id }) => ({ key, kind, status, ...(id ? { id } : {}) }));
}

async function retainingAcknowledgedSteps(
  steps: MetaPausedStep[],
  externalEffectPossible: () => boolean,
  operation: () => Promise<MetaPausedCreationOutcome>,
): Promise<MetaPausedCreationOutcome> {
  try {
    return await operation();
  } catch (cause) {
    const error = new MetaPausedProviderError(
      cause instanceof MetaPausedProviderError ? cause.code : "meta_paused_request_failed",
      externalEffectPossible(),
    );
    // Only engine-owned state is retained, never properties from thrown/provider objects.
    const acknowledged = copySteps(steps);
    acknowledged.forEach((step) => Object.freeze(step));
    Object.freeze(acknowledged);
    acknowledgedStepsByError.set(error, acknowledged);
    throw error;
  }
}

function snapshotForRequest(input: MetaPausedSnapshot, creating: boolean): MetaPausedSnapshot {
  try {
    const snapshot = structuredClone(input);
    // Validate unknown keys and offset/zone consistency without normalizing the approved payload.
    parsePaidCampaignSnapshotV1(snapshot);
    assertMetaPausedSnapshot(snapshot);
    const delivery = snapshot.metaDelivery;
    const group = snapshot.adGroups[0];
    const targeting = group.targeting;
    const startsAt = Date.parse(snapshot.schedule.startsAt);
    const endsAt = Date.parse(snapshot.schedule.endsAt);
    const genders = targeting.genders;
    if (!numericAccountId(snapshot.connection.accountId) || !graphId(delivery.pageId)
      || !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt >= endsAt
      || (creating && startsAt <= Date.now())
      || targeting.kind !== "audience" || !targeting.locations.length
      || new Set(targeting.locations).size !== targeting.locations.length
      || !Number.isInteger(targeting.ageMin) || !Number.isInteger(targeting.ageMax)
      || targeting.ageMin < 18 || targeting.ageMax > 65 || targeting.ageMin > targeting.ageMax
      || !genders.length || new Set(genders).size !== genders.length
      || genders.some((gender) => !["all", "female", "male"].includes(gender))
      || (genders.includes("all") && genders.length !== 1)
      || group.ads.length < 1 || group.ads.length > 3
      || new Set(group.ads.map((ad) => ad.localId)).size !== group.ads.length
      || group.ads.some((ad) => ad.assetIds.length !== 1 || !ad.assetIds[0]
        || !Object.hasOwn(CTA, ad.callToAction))) {
      throw new Error("invalid");
    }
    return snapshot;
  } catch {
    throw new MetaPausedProviderError("meta_paused_invalid_snapshot", !creating);
  }
}

function stepDefinitions(snapshot: MetaPausedSnapshot): StepDefinition[] {
  const ads = snapshot.adGroups[0].ads;
  return [
    { key: "campaign", kind: "campaign" },
    { key: "adset", kind: "adset" },
    ...Array.from(new Set(ads.map((ad) => ad.assetIds[0])), (assetId) => ({
      key: `image:${assetId}`, kind: "image" as const,
    })),
    ...ads.flatMap((ad) => [
      { key: `creative:${ad.localId}`, kind: "creative" as const },
      { key: `ad:${ad.localId}`, kind: "ad" as const },
    ]),
  ];
}

function client(input: MetaPausedProviderInput, alreadySubmitted: boolean) {
  if (!input.accessToken || /[\s\x00-\x1f\x7f]/.test(input.accessToken)
    || (input.appSecretProof !== null && !/^[a-fA-F0-9]{64}$/.test(input.appSecretProof))) {
    throw new MetaPausedProviderError("meta_paused_invalid_credentials", alreadySubmitted);
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  let externalEffectPossible = alreadySubmitted;
  const fail = (code: string): never => { throw new MetaPausedProviderError(code, externalEffectPossible); };

  async function request(path: string, method: "GET" | "POST", params: JsonObject): Promise<JsonObject> {
    // No caller-controlled host, pagination URLs, arbitrary Graph nodes, or existing-object POSTs.
    const allowed = method === "POST"
      ? /^act_\d{1,32}\/(campaigns|adsets|adimages|adcreatives|ads)$/.test(path)
      : /^(act_)?\d{1,32}$/.test(path);
    if (!allowed) return fail("meta_paused_invalid_snapshot");
    const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`);
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      form.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    if (input.appSecretProof !== null) form.set("appsecret_proof", input.appSecretProof);
    if (method === "GET") url.search = form.toString();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new MetaPausedProviderError("meta_paused_request_timeout", externalEffectPossible));
      }, REQUEST_TIMEOUT_MS);
    });
    try {
      if (method === "POST") externalEffectPossible = true;
      const body = await Promise.race([
        (async () => {
          const response = await fetchImpl(url, {
            method, redirect: "error", signal: controller.signal,
            headers: {
              Authorization: `Bearer ${input.accessToken}`, Accept: "application/json",
              ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
            },
            ...(method === "POST" ? { body: form.toString() } : {}),
          });
          if (!response.ok) return fail("meta_paused_provider_rejected");
          const contentLength = response.headers.get("content-length");
          if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_RESPONSE_BYTES) {
            controller.abort();
            void response.body?.cancel().catch(() => {});
            return fail("meta_paused_response_too_large");
          }
          if (!response.body) return fail("meta_paused_response_invalid");
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let length = 0;
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              length += chunk.value.byteLength;
              if (length > MAX_RESPONSE_BYTES) {
                controller.abort();
                void reader.cancel().catch(() => {});
                return fail("meta_paused_response_too_large");
              }
              chunks.push(chunk.value);
            }
          } finally {
            reader.releaseLock();
          }
          let json: unknown;
          try { json = JSON.parse(Buffer.concat(chunks, length).toString("utf8")); }
          catch { return fail("meta_paused_response_invalid"); }
          if (!object(json)) return fail("meta_paused_response_invalid");
          if (Object.hasOwn(json, "error")) return fail("meta_paused_provider_rejected");
          return json;
        })(),
        timeout,
      ]);
      return body;
    } catch (error) {
      if (timedOut) return fail("meta_paused_request_timeout");
      if (error instanceof MetaPausedProviderError) return fail(error.code);
      return fail("meta_paused_request_failed");
    } finally {
      clearTimeout(timer);
    }
  }
  return { request, fail, externalEffectPossible: () => externalEffectPossible };
}

function completedSteps(snapshot: MetaPausedSnapshot, input: readonly MetaPausedStep[]): MetaPausedStep[] {
  const expected = stepDefinitions(snapshot);
  if (!Array.isArray(input) || input.length !== expected.length) {
    throw new MetaPausedProviderError("meta_paused_verification_incomplete", true);
  }
  const ids = new Set<string>();
  const steps: MetaPausedStep[] = [];
  for (let index = 0; index < expected.length; index += 1) {
    const step = input[index];
    const definition = expected[index];
    if (!step || step.key !== definition.key || step.kind !== definition.kind || step.status !== "created"
      || typeof step.id !== "string"
      || !(step.kind === "image" ? IMAGE_HASH.test(step.id) : graphId(step.id))) {
      throw new MetaPausedProviderError("meta_paused_verification_incomplete", true);
    }
    if (step.kind !== "image") {
      if (ids.has(step.id)) throw new MetaPausedProviderError("meta_paused_duplicate_id", true);
      ids.add(step.id);
    }
    steps.push({ key: definition.key, kind: definition.kind, status: "created", id: step.id });
  }
  return steps;
}

/** Read-only reconciliation; incomplete/uncertain submissions must never be recreated here. */
export async function verifyMetaPausedCreation(input: MetaPausedVerificationInput): Promise<MetaPausedCreationOutcome> {
  const snapshot = snapshotForRequest(input.snapshot, false);
  const steps = completedSteps(snapshot, input.steps);
  return retainingAcknowledgedSteps(steps, () => true, async () => {
    const { request, fail } = client(input, true);
    const id = (key: string): string => steps.find((step) => step.key === key)!.id!;
    const campaignId = id("campaign");
    const adsetId = id("adset");
    const accountId = numericAccountId(snapshot.connection.accountId)!;
    const verify = (body: JsonObject, expectedId: string, parents: Record<string, string> = {}) => {
      if (!graphId(body.id) || body.id !== expectedId || !graphId(body.account_id)
        || body.account_id !== accountId || body.status !== "PAUSED"
        || Object.entries(parents).some(([key, value]) => !graphId(body[key]) || body[key] !== value)) {
        fail("meta_paused_verification_mismatch");
      }
    };
    verify(await request(campaignId, "GET", { fields: "id,account_id,status" }), campaignId);
    verify(await request(adsetId, "GET", { fields: "id,account_id,campaign_id,status" }), adsetId, {
      campaign_id: campaignId,
    });
    for (const ad of snapshot.adGroups[0].ads) {
      const adId = id(`ad:${ad.localId}`);
      const body = await request(adId, "GET", { fields: "id,account_id,campaign_id,adset_id,status,creative{id}" });
      verify(body, adId, { campaign_id: campaignId, adset_id: adsetId });
      if (!object(body.creative) || !graphId(body.creative.id) || body.creative.id !== id(`creative:${ad.localId}`)) {
        fail("meta_paused_verification_mismatch");
      }
    }
    return { campaignId, steps };
  });
}

/** The caller owns durable attempt locks, exact approval binding, asset authorization and live permissions. */
export async function runMetaPausedCreation(input: MetaPausedCreationInput): Promise<MetaPausedCreationOutcome> {
  const snapshot = snapshotForRequest(input.snapshot, true);
  const images = new Map<string, Buffer>();
  for (const ad of snapshot.adGroups[0].ads) {
    const assetId = ad.assetIds[0];
    const bytes = input.images.get(assetId);
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw new MetaPausedProviderError("meta_paused_missing_image", false);
    images.set(assetId, Buffer.from(bytes));
  }
  const { request, fail, externalEffectPossible } = client(input, false);
  const accountId = numericAccountId(snapshot.connection.accountId)!;
  const accountPath = `act_${accountId}`;
  const account = await request(accountPath, "GET", { fields: "id,account_id,currency" });
  if (account.id !== accountPath || !graphId(account.account_id) || account.account_id !== accountId
    || account.currency !== snapshot.budget.currency) return fail("meta_paused_account_mismatch");
  const steps: MetaPausedStep[] = [];
  const usedIds = new Set<string>();
  async function checkpoint() {
    try { await input.checkpoint(copySteps(steps)); } catch { fail("meta_paused_checkpoint_failed"); }
  }
  async function create(key: string, kind: MetaPausedStep["kind"], edge: string, params: JsonObject): Promise<string> {
    steps.push({ key, kind, status: "submitting" });
    await checkpoint();
    const result = await request(`${accountPath}/${edge}`, "POST", params);
    let id: unknown = result.id;
    if (kind === "image") {
      if (!object(result.images) || Object.keys(result.images).length !== 1) return fail("meta_paused_response_invalid");
      const image = Object.values(result.images)[0];
      id = object(image) ? image.hash : undefined;
    }
    if (typeof id !== "string" || !(kind === "image" ? IMAGE_HASH.test(id) : graphId(id))) {
      return fail("meta_paused_response_invalid");
    }
    // Meta deduplicates identical image bytes across distinct approved assets.
    if (kind !== "image") {
      if (usedIds.has(id)) {
        steps[steps.length - 1] = { key, kind, status: "submitting", id };
        return fail("meta_paused_duplicate_id");
      }
      usedIds.add(id);
    }
    steps[steps.length - 1] = { key, kind, status: "created", id };
    await checkpoint();
    return id;
  }
  return retainingAcknowledgedSteps(steps, externalEffectPossible, async () => {
    const campaignId = await create("campaign", "campaign", "campaigns", {
      name: snapshot.campaign.name, objective: "OUTCOME_TRAFFIC", status: "PAUSED",
      special_ad_categories: [], buying_type: "AUCTION", is_adset_budget_sharing_enabled: false,
    });
    const group = snapshot.adGroups[0];
    const audience = group.targeting;
    const adsetId = await create("adset", "adset", "adsets", {
      name: group.name, campaign_id: campaignId, status: "PAUSED",
      [snapshot.budget.cadence === "daily" ? "daily_budget" : "lifetime_budget"]: snapshot.budget.amountMinor,
      billing_event: "IMPRESSIONS", optimization_goal: "LINK_CLICKS", bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      destination_type: "WEBSITE", start_time: snapshot.schedule.startsAt, end_time: snapshot.schedule.endsAt,
      dsa_beneficiary: snapshot.metaDelivery.beneficiary, dsa_payor: snapshot.metaDelivery.payer,
      targeting: {
        geo_locations: { countries: audience.locations }, age_min: audience.ageMin, age_max: audience.ageMax,
        ...(audience.genders.includes("all") ? {} : { genders: audience.genders.map((gender) => gender === "male" ? 1 : 2) }),
        publisher_platforms: ["facebook"], facebook_positions: ["feed"],
      },
    });
    const hashes = new Map<string, string>();
    for (const [assetId, bytes] of images) {
      hashes.set(assetId, await create(`image:${assetId}`, "image", "adimages", { bytes: bytes.toString("base64") }));
    }
    for (const ad of group.ads) {
      const creativeId = await create(`creative:${ad.localId}`, "creative", "adcreatives", {
        name: ad.name,
        object_story_spec: {
          page_id: snapshot.metaDelivery.pageId,
          link_data: {
            image_hash: hashes.get(ad.assetIds[0])!, link: ad.destinationUrl, message: ad.primaryText,
            name: ad.headline, ...(ad.description === null ? {} : { description: ad.description }),
            call_to_action: { type: CTA[ad.callToAction], value: { link: ad.destinationUrl } },
          },
        },
      });
      await create(`ad:${ad.localId}`, "ad", "ads", {
        name: ad.name, adset_id: adsetId, creative: { creative_id: creativeId }, status: "PAUSED",
      });
    }
    return verifyMetaPausedCreation({
      snapshot, steps, accessToken: input.accessToken, appSecretProof: input.appSecretProof, fetchImpl: input.fetchImpl,
    });
  });
}
