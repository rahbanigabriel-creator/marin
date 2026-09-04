import assert from "node:assert/strict";
import test from "node:test";

import type { Connection } from "@prisma/client";

import {
  createPaidReadClient,
  isPaidSyncPlatform,
  PAID_SYNC_PLATFORMS,
  safePaidClient,
} from "../paid-clients";
import { PaidProviderError } from "../paid-errors";
import { META_GRAPH_VERSION } from "../registry";

const RANGE = {
  from: new Date("2026-07-01T00:00:00.000Z"),
  to: new Date("2026-07-02T00:00:00.000Z"),
};

function connection(platform: string, externalAccountId = "123"): Connection {
  return {
    id: `${platform}-connection`,
    workspaceId: "workspace-1",
    platform,
    externalAccountId,
    displayName: "Test account",
    status: "connected",
    scopes: null,
    encAccessToken: "encrypted",
    encRefreshToken: null,
    expiresAt: null,
    currency: null,
    timezone: null,
    lastSyncAt: null,
    lastSuccessfulSyncAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const tokenProvider = async () => "mock-access-token";

test("default paid sync scope contains only Google Ads and Meta Ads", () => {
  assert.deepEqual(PAID_SYNC_PLATFORMS, ["google_ads", "meta_ads"]);
  assert.equal(isPaidSyncPlatform("google_ads"), true);
  assert.equal(isPaidSyncPlatform("meta_ads"), true);
  assert.equal(isPaidSyncPlatform("tiktok_ads"), false);
  assert.throws(
    () => safePaidClient("tiktok_ads"),
    (error: unknown) => error instanceof PaidProviderError && error.code === "not_supported",
  );
});

test("Google direct-account reporting never applies a process-global manager account", async () => {
  const previousDeveloperToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const previousLoginCustomer = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "developer-token-for-test";
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "999-999-9999";
  const headers: Headers[] = [];
  try {
    const fetchMock = (async (_request: string | URL | Request, init?: RequestInit) => {
      headers.push(new Headers(init?.headers));
      const query = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
      return query.query?.includes("FROM customer")
        ? json([{ results: [{ customer: { currencyCode: "EUR", timeZone: "Europe/Madrid" } }] }])
        : json([{ results: [] }]);
    }) as typeof fetch;

    await createPaidReadClient("google_ads", fetchMock, tokenProvider)
      .fetchMetricsSnapshot(connection("google_ads", "2222222222"), RANGE);
    assert.ok(headers.length >= 2);
    assert.ok(headers.every((value) => value.get("login-customer-id") === null));
  } finally {
    if (previousDeveloperToken === undefined) delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    else process.env.GOOGLE_ADS_DEVELOPER_TOKEN = previousDeveloperToken;
    if (previousLoginCustomer === undefined) delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    else process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = previousLoginCustomer;
  }
});

test("Meta metrics follows every page without putting the token in the URL", async () => {
  const urls: string[] = [];
  const fetchMock = (async (request: string | URL | Request) => {
    const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url);
    urls.push(url.toString());
    if (url.pathname.endsWith("/act_123")) {
      return json({ currency: "EUR", timezone_name: "Europe/Madrid" });
    }
    if (url.pathname.endsWith("/meta-page-2")) {
      return json({ data: [{ campaign_id: "campaign-2", campaign_name: "Second", clicks: "0", date_start: "2026-07-02" }] });
    }
    return json({
      data: [{ campaign_id: "campaign-1", campaign_name: "First", spend: "0", impressions: "10", date_start: "2026-07-01" }],
      paging: { next: `https://graph.facebook.com/${META_GRAPH_VERSION}/meta-page-2` },
    });
  }) as typeof fetch;
  const client = createPaidReadClient("meta_ads", fetchMock, tokenProvider);
  const result = await client.fetchMetricsSnapshot(connection("meta_ads"), RANGE);
  assert.equal(result.complete, true);
  assert.deepEqual(new Set(result.items.map((item) => item.campaignExternalId)), new Set(["campaign-1", "campaign-2"]));
  assert.equal(result.items.find((item) => item.metric === "spend")?.value, 0);
  assert.equal(result.items.find((item) => item.campaignExternalId === "campaign-2" && item.metric === "clicks")?.value, 0);
  assert.ok(urls.every((url) => !url.includes("mock-access-token")));
});

test("TikTok reporting follows total_page and preserves missing metrics", async () => {
  const pages: number[] = [];
  const fetchMock = (async (request: string | URL | Request) => {
    const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    if (url.pathname.endsWith("/advertiser/info/")) {
      return json({ code: 0, data: { list: [{ currency: "USD", timezone: "America/New_York" }], page_info: { page: 1, total_page: 1 } } });
    }
    pages.push(page);
    const campaignId = page === 1 ? "campaign-1" : "campaign-2";
    return json({
      code: 0,
      data: {
        list: [{
          dimensions: { campaign_id: campaignId, stat_time_day: page === 1 ? "2026-07-01" : "2026-07-02" },
          metrics: page === 1 ? { campaign_name: "First", spend: "0" } : { campaign_name: "Second", clicks: "4" },
        }],
        page_info: { page, total_page: 2 },
      },
    });
  }) as typeof fetch;
  const client = createPaidReadClient("tiktok_ads", fetchMock, tokenProvider);
  const result = await client.fetchMetricsSnapshot(connection("tiktok_ads", "advertiser-1"), RANGE);
  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.currency, "USD");
  assert.equal(result.items.find((item) => item.campaignExternalId === "campaign-1" && item.metric === "spend")?.value, 0);
  assert.equal(result.items.some((item) => item.campaignExternalId === "campaign-1" && item.metric === "clicks"), false);
});

test("Google rejects malformed search streams and does not turn missing numerics into zero", async () => {
  const previousToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "developer-token-for-test";
  try {
    const validFetch = (async (_request: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
      if (body.query?.includes("FROM customer")) {
        return json([{ results: [{ customer: { currencyCode: "EUR", timeZone: "Europe/Madrid" } }] }]);
      }
      return json([{ results: [{
        campaign: { id: "campaign-1", name: "Campaign" },
        metrics: { clicks: "0" },
        segments: { date: "2026-07-01" },
      }] }]);
    }) as typeof fetch;
    const validClient = createPaidReadClient("google_ads", validFetch, tokenProvider);
    const valid = await validClient.fetchMetricsSnapshot(connection("google_ads"), RANGE);
    assert.deepEqual(valid.items.map((item) => [item.metric, item.value]), [["clicks", 0]]);

    const malformedFetch = (async (_request: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
      return body.query?.includes("FROM customer")
        ? json([{ results: [{ customer: { currencyCode: "EUR" } }] }])
        : new Response("not-json", { status: 200 });
    }) as typeof fetch;
    const malformedClient = createPaidReadClient("google_ads", malformedFetch, tokenProvider);
    await assert.rejects(
      () => malformedClient.fetchMetricsSnapshot(connection("google_ads"), RANGE),
      (error: unknown) => error instanceof PaidProviderError
        && error.code === "invalid_response"
        && !/not-json|developer-token/i.test(error.message),
    );
  } finally {
    if (previousToken === undefined) delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    else process.env.GOOGLE_ADS_DEVELOPER_TOKEN = previousToken;
  }
});

test("provider error bodies stay out of public errors", async () => {
  const fetchMock = (async () => json({ error: { message: "raw secret payload" } }, 500)) as typeof fetch;
  const client = createPaidReadClient("meta_ads", fetchMock, tokenProvider);
  await assert.rejects(
    () => client.fetchMetricsSnapshot(connection("meta_ads"), RANGE),
    (error: unknown) => error instanceof PaidProviderError
      && error.code === "provider"
      && !/raw secret payload/i.test(error.message),
  );
});

test("Google accepts only SearchStream arrays and treats an explicit empty array as complete", async () => {
  const previousToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "developer-token-for-test";
  try {
    for (const malformed of [{}, [{}], ""]) {
      const fetchMock = (async (_request: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
        if (body.query?.includes("FROM customer")) return json([{ results: [] }]);
        return malformed === "" ? new Response("", { status: 200 }) : json(malformed);
      }) as typeof fetch;
      const client = createPaidReadClient("google_ads", fetchMock, tokenProvider);
      await assert.rejects(
        () => client.fetchMetricsSnapshot(connection("google_ads"), RANGE),
        (error: unknown) => error instanceof PaidProviderError && error.code === "invalid_response",
      );
    }

    const emptyClient = createPaidReadClient(
      "google_ads",
      (async () => json([])) as typeof fetch,
      tokenProvider,
    );
    const empty = await emptyClient.fetchMetricsSnapshot(connection("google_ads"), RANGE);
    assert.equal(empty.complete, true);
    assert.deepEqual(empty.items, []);
  } finally {
    if (previousToken === undefined) delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    else process.env.GOOGLE_ADS_DEVELOPER_TOKEN = previousToken;
  }
});

test("Meta requires a data array but accepts an explicit empty data array", async () => {
  const malformedClient = createPaidReadClient(
    "meta_ads",
    (async (request: string | URL | Request) => {
      const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url);
      if (url.pathname.endsWith("/act_123")) return json({ currency: "EUR", timezone_name: "Europe/Madrid" });
      return json({ paging: {} });
    }) as typeof fetch,
    tokenProvider,
  );
  await assert.rejects(
    () => malformedClient.fetchMetricsSnapshot(connection("meta_ads"), RANGE),
    (error: unknown) => error instanceof PaidProviderError && error.code === "invalid_response",
  );

  const emptyClient = createPaidReadClient(
    "meta_ads",
    (async (request: string | URL | Request) => {
      const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url);
      return url.pathname.endsWith("/act_123")
        ? json({ currency: "EUR", timezone_name: "Europe/Madrid" })
        : json({ data: [] });
    }) as typeof fetch,
    tokenProvider,
  );
  const empty = await emptyClient.fetchMetricsSnapshot(connection("meta_ads"), RANGE);
  assert.equal(empty.complete, true);
  assert.deepEqual(empty.items, []);
});

test("TikTok requires data.list but accepts an explicit empty list", async () => {
  const malformedClient = createPaidReadClient(
    "tiktok_ads",
    (async (request: string | URL | Request) => {
      const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url);
      if (url.pathname.endsWith("/advertiser/info/")) {
        return json({ code: 0, data: { list: [{ currency: "USD", timezone: "UTC" }] } });
      }
      return json({ code: 0, data: {} });
    }) as typeof fetch,
    tokenProvider,
  );
  await assert.rejects(
    () => malformedClient.fetchMetricsSnapshot(connection("tiktok_ads"), RANGE),
    (error: unknown) => error instanceof PaidProviderError && error.code === "invalid_response",
  );

  const emptyClient = createPaidReadClient(
    "tiktok_ads",
    (async () => json({ code: 0, data: { list: [] } })) as typeof fetch,
    tokenProvider,
  );
  const empty = await emptyClient.fetchMetricsSnapshot(connection("tiktok_ads"), RANGE);
  assert.equal(empty.complete, true);
  assert.deepEqual(empty.items, []);
});

test("Meta conversions follow the campaign objective and fail closed when ambiguous", async () => {
  const fetchMock = (async (request: string | URL | Request) => {
    const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url);
    if (url.pathname.endsWith("/act_123")) return json({ currency: "EUR", timezone_name: "Europe/Madrid" });
    return json({
      data: [
        {
          campaign_id: "lead-campaign",
          campaign_name: "Lead campaign",
          objective: "OUTCOME_LEADS",
          actions: [
            { action_type: "purchase", value: "99" },
            { action_type: "lead", value: "4" },
          ],
          date_start: "2026-07-01",
        },
        {
          campaign_id: "ambiguous-lead-campaign",
          campaign_name: "Ambiguous lead campaign",
          objective: "OUTCOME_LEADS",
          actions: [
            { action_type: "lead", value: "4" },
            { action_type: "omni_lead", value: "5" },
          ],
          date_start: "2026-07-01",
        },
        {
          campaign_id: "traffic-campaign",
          campaign_name: "Traffic campaign",
          objective: "OUTCOME_TRAFFIC",
          actions: [{ action_type: "purchase", value: "12" }],
          date_start: "2026-07-01",
        },
      ],
    });
  }) as typeof fetch;
  const result = await createPaidReadClient("meta_ads", fetchMock, tokenProvider)
    .fetchMetricsSnapshot(connection("meta_ads"), RANGE);
  assert.equal(result.items.find((row) => row.campaignExternalId === "lead-campaign" && row.metric === "conversions")?.value, 4);
  assert.equal(result.items.some((row) => row.campaignExternalId === "lead-campaign" && row.metric === "conversions" && row.value === 99), false);
  assert.equal(result.items.some((row) => row.campaignExternalId === "ambiguous-lead-campaign" && row.metric === "conversions"), false);
  assert.equal(result.items.some((row) => row.campaignExternalId === "traffic-campaign" && row.metric === "conversions"), false);
});

test("Google rejects a malformed inner metrics row instead of filtering it", async () => {
  const previousToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "developer-token-for-test";
  try {
    for (const malformedRow of [
      {},
      { campaign: { id: "campaign-2" }, metrics: {}, segments: { date: "2026-02-30" } },
    ]) {
      const fetchMock = (async (_request: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
        return body.query?.includes("FROM customer")
          ? json([{ results: [{ customer: { currencyCode: "EUR", timeZone: "Europe/Madrid" } }] }])
          : json([{ results: [
            {
              campaign: { id: "campaign-1", name: "Valid" },
              metrics: { clicks: "3" },
              segments: { date: "2026-07-01" },
            },
            malformedRow,
          ] }]);
      }) as typeof fetch;
      await assert.rejects(
        () => createPaidReadClient("google_ads", fetchMock, tokenProvider)
          .fetchMetricsSnapshot(connection("google_ads"), RANGE),
        (error: unknown) => error instanceof PaidProviderError && error.code === "invalid_response",
      );
    }
  } finally {
    if (previousToken === undefined) delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    else process.env.GOOGLE_ADS_DEVELOPER_TOKEN = previousToken;
  }
});

test("Meta rejects data containing a malformed inner row", async () => {
  for (const malformedRow of [{}, { campaign_id: "campaign-1", date_start: "2026-02-30" }]) {
    const fetchMock = (async (request: string | URL | Request) => {
      const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url);
      if (url.pathname.endsWith("/act_123")) return json({ currency: "EUR", timezone_name: "Europe/Madrid" });
      return json({ data: [malformedRow] });
    }) as typeof fetch;
    await assert.rejects(
      () => createPaidReadClient("meta_ads", fetchMock, tokenProvider)
        .fetchMetricsSnapshot(connection("meta_ads"), RANGE),
      (error: unknown) => error instanceof PaidProviderError && error.code === "invalid_response",
    );
  }
});

test("Meta rejects malformed nested creative fields before reconciliation", async () => {
  const malformedCreatives = [
    { object_story_spec: { link_data: "not-an-object" } },
    { object_story_spec: { video_data: { call_to_action: [] } } },
    { object_story_spec: { link_data: { message: 42 } } },
    { thumbnail_url: { href: "https://example.test/image.png" } },
  ];

  for (const creative of malformedCreatives) {
    const fetchMock = (async (request: string | URL | Request) => {
      const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url);
      if (url.pathname.endsWith("/act_123")) {
        return json({ currency: "EUR", timezone_name: "Europe/Madrid" });
      }
      if (url.pathname.endsWith("/insights")) return json({ data: [] });
      if (url.pathname.endsWith("/ads")) {
        return json({
          data: [{
            id: "ad-1",
            name: "Malformed creative",
            campaign_id: "campaign-1",
            creative,
          }],
        });
      }
      return json({ data: [] });
    }) as typeof fetch;

    await assert.rejects(
      () => createPaidReadClient("meta_ads", fetchMock, tokenProvider)
        .fetchAdsSnapshot(connection("meta_ads"), RANGE),
      (error: unknown) => error instanceof PaidProviderError && error.code === "invalid_response",
    );
  }
});

test("TikTok rejects a malformed inner reporting row", async () => {
  for (const malformedRow of [
    {},
    { dimensions: { campaign_id: "campaign-1", stat_time_day: "2026-02-30" }, metrics: {} },
  ]) {
    const fetchMock = (async (request: string | URL | Request) => {
      const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url);
      if (url.pathname.endsWith("/advertiser/info/")) {
        return json({ code: 0, data: { list: [{ currency: "USD", timezone: "UTC" }] } });
      }
      return json({ code: 0, data: { list: [malformedRow] } });
    }) as typeof fetch;
    await assert.rejects(
      () => createPaidReadClient("tiktok_ads", fetchMock, tokenProvider)
        .fetchMetricsSnapshot(connection("tiktok_ads", "advertiser-1"), RANGE),
      (error: unknown) => error instanceof PaidProviderError && error.code === "invalid_response",
    );
  }
});

test("Meta never sends its bearer token to an untrusted paging URL", async () => {
  const unsafeNextUrls = [
    "http://graph.facebook.com/v25.0/next",
    "https://attacker.example/v25.0/next",
    "https://user:pass@graph.facebook.com/v25.0/next",
    "https://graph.facebook.com:444/v25.0/next",
    "https://graph.facebook.com/v24.0/next",
  ];
  for (const unsafeNext of unsafeNextUrls) {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const fetchMock = (async (request: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url);
      const headers = new Headers(init?.headers);
      requests.push({ url: url.toString(), authorization: headers.get("authorization") });
      if (url.pathname.endsWith("/act_123")) return json({ currency: "EUR", timezone_name: "Europe/Madrid" });
      return json({
        data: [{ campaign_id: "campaign-1", campaign_name: "Campaign", date_start: "2026-07-01" }],
        paging: { next: unsafeNext },
      });
    }) as typeof fetch;
    await assert.rejects(
      () => createPaidReadClient("meta_ads", fetchMock, tokenProvider)
        .fetchMetricsSnapshot(connection("meta_ads"), RANGE),
      (error: unknown) => error instanceof PaidProviderError && error.code === "invalid_response",
    );
    assert.ok(requests.length >= 2);
    assert.ok(requests.every((entry) => new URL(entry.url).origin === "https://graph.facebook.com"));
    assert.ok(requests.every((entry) => entry.authorization === "Bearer mock-access-token"));
    assert.equal(requests.some((entry) => entry.url === unsafeNext), false);
  }
});
