import assert from "node:assert/strict";
import test from "node:test";

import {
  appleAppStoreListingId,
  auditSite,
  extractSiteAudit,
  isPublicIpAddress,
  isAppleAppStoreListingUrl,
  normalizeSiteUrl,
  SiteAuditError,
  validatePublicSiteUrl,
  type SiteDnsResolver,
  type SiteFetch,
} from "../site";

const PUBLIC_DNS: SiteDnsResolver = async () => [{ address: "93.184.216.34", family: 4 }];

function hasAuditCode(code: SiteAuditError["code"]): (error: unknown) => boolean {
  return (error) => error instanceof SiteAuditError && error.code === code;
}

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "text/html; charset=utf-8");
  return new Response(body, { ...init, headers });
}

test("normalizeSiteUrl adds HTTPS, preserves HTTP and ports, and strips fragments", () => {
  assert.equal(normalizeSiteUrl("  example.com/path?q=one#section  ").href, "https://example.com/path?q=one");
  assert.equal(normalizeSiteUrl("http://example.com/a").href, "http://example.com/a");
  assert.equal(normalizeSiteUrl("example.com:8080/a").href, "https://example.com:8080/a");
  assert.equal(normalizeSiteUrl("//example.com/path").href, "https://example.com/path");
});

test("normalizeSiteUrl rejects unsupported schemes and embedded credentials", () => {
  assert.throws(() => normalizeSiteUrl("ftp://example.com/archive"), hasAuditCode("INVALID_URL"));
  assert.throws(() => normalizeSiteUrl("https://gabriel:secret@example.com"), hasAuditCode("UNSAFE_URL"));
  assert.throws(() => normalizeSiteUrl("javascript:alert(1)"), hasAuditCode("INVALID_URL"));
});

test("App Store listing detection requires Apple's exact host and an app id path", () => {
  const fitura = "https://apps.apple.com/us/app/fitura/id6743079022?platform=watch";
  assert.equal(appleAppStoreListingId(fitura), "6743079022");
  assert.equal(isAppleAppStoreListingUrl(fitura), true);
  assert.equal(isAppleAppStoreListingUrl("https://apps.apple.com/app/id6743079022"), true);
  assert.equal(isAppleAppStoreListingUrl("https://apps.apple.com/us/developer/example/id123"), false);
  assert.equal(isAppleAppStoreListingUrl("https://apps.apple.com.attacker.example/us/app/fitura/id6743079022"), false);
  assert.equal(isAppleAppStoreListingUrl("https://example.com/us/app/fitura/id6743079022"), false);
});

test("literal local, loopback, link-local, private, and reserved targets are blocked", () => {
  const blocked = [
    "http://localhost:3000",
    "http://service.localhost",
    "http://printer.local",
    "http://intranet",
    "http://127.0.0.1",
    "http://127.1",
    "http://2130706433",
    "http://10.20.30.40",
    "http://100.64.0.1",
    "http://169.254.169.254/latest/meta-data",
    "http://172.31.0.1",
    "http://192.168.1.1",
    "http://198.51.100.10",
    "http://[::1]",
    "http://[fe80::1]",
    "http://[fd00::1234]",
    "http://[::ffff:127.0.0.1]",
  ];

  for (const input of blocked) {
    assert.throws(() => normalizeSiteUrl(input), hasAuditCode("UNSAFE_URL"), input);
  }

  assert.equal(normalizeSiteUrl("http://93.184.216.34").hostname, "93.184.216.34");
  assert.equal(normalizeSiteUrl("http://[2606:4700:4700::1111]").hostname, "[2606:4700:4700::1111]");
});

test("isPublicIpAddress handles public, private, mapped, and malformed addresses", () => {
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("192.168.0.4"), false);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
  assert.equal(isPublicIpAddress("::ffff:10.0.0.1"), false);
  assert.equal(isPublicIpAddress("::ffff:8.8.8.8"), true);
  assert.equal(isPublicIpAddress("not-an-ip"), false);
});

test("validatePublicSiteUrl rejects private and mixed DNS answers", async () => {
  await assert.rejects(
    () => validatePublicSiteUrl("https://example.com", async () => [{ address: "10.0.0.8", family: 4 }]),
    hasAuditCode("UNSAFE_URL"),
  );
  await assert.rejects(
    () =>
      validatePublicSiteUrl("https://example.com", async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "fd00::8", family: 6 },
      ]),
    hasAuditCode("UNSAFE_URL"),
  );
  await assert.rejects(
    () => validatePublicSiteUrl("https://example.com", async () => []),
    hasAuditCode("DNS_LOOKUP_FAILED"),
  );
});

test("extractSiteAudit extracts metadata, headings, links, images, robots, and JSON-LD", () => {
  const html = `<!doctype html>
    <html lang="en-GB">
      <head>
        <title>Marpin &amp; the Complete Distribution System for Founders</title>
        <meta name="description" content="Plan, create, and review a complete organic distribution system for your startup from one focused workspace.">
        <meta name="robots" content="index, follow">
        <link rel="alternate canonical" href="/preferred">
        <script type="application/ld+json">
          {"@context":"https://schema.org","@graph":[
            {"@type":["Organization","Brand"]},
            {"@type":"WebSite","publisher":{"@type":"Person"}}
          ]}
        </script>
      </head>
      <body>
        <h1>Distribution for <em>solo founders</em></h1>
        <h2>Plan organic content</h2>
        <p>Turn one product story into useful posts, videos, and campaigns that build demand across the channels your customers actually use.</p>
        <a href="/pricing">Pricing</a>
        <a href="https://www.example.com/about">About us</a>
        <a href="https://partner.example.net/report">Research partner</a>
        <a href="mailto:hello@example.com">Email</a>
        <img src="hero.jpg" alt="Marpin content calendar">
        <img src="shape.jpg" alt="">
        <img src="chart.jpg">
        <script>window.hiddenWords = 'these words do not count';</script>
      </body>
    </html>`;

  const result = extractSiteAudit(html, {
    sourceUrl: "example.com/start#ignored",
    finalUrl: "https://example.com/start",
  });

  assert.equal(result.sourceUrl, "https://example.com/start");
  assert.equal(result.finalUrl, "https://example.com/start");
  assert.equal(result.title, "Marpin & the Complete Distribution System for Founders");
  assert.equal(
    result.metaDescription,
    "Plan, create, and review a complete organic distribution system for your startup from one focused workspace.",
  );
  assert.equal(result.canonical, "https://example.com/preferred");
  assert.equal(result.lang, "en-gb");
  assert.deepEqual(result.headings.h1, ["Distribution for solo founders"]);
  assert.deepEqual(result.headings.h2, ["Plan organic content"]);
  assert.equal(result.headings.h1Count, 1);
  assert.equal(result.headings.h2Count, 1);
  assert.ok(result.wordCount >= 25);
  assert.deepEqual(result.links, { total: 3, internal: 2, external: 1 });
  assert.deepEqual(result.images, { total: 3, withAlt: 2, withoutAlt: 1 });
  assert.deepEqual(result.robots.directives, ["index", "follow"]);
  assert.equal(result.robots.indexAllowed, true);
  assert.equal(result.robots.followAllowed, true);
  assert.deepEqual(result.jsonLdTypes, ["Brand", "Organization", "Person", "WebSite"]);
  assert.equal(result.jsonLdBlockCount, 1);
  assert.equal(result.invalidJsonLdBlockCount, 0);
  assert.ok(result.findings.some((finding) => finding.code === "image-alt-missing"));
  assert.ok(result.findings.every((finding) => finding.evidence && finding.recommendation));
});

test("scoring produces actionable findings for a severely deficient page", () => {
  const result = extractSiteAudit(
    `<html><head>
      <meta name="robots" content="noindex,nofollow">
      <script type="application/ld+json">{"@type":</script>
    </head><body><p>Tiny page.</p><img src="missing-alt.png"></body></html>`,
    { sourceUrl: "https://example.com", finalUrl: "https://example.com" },
  );

  const codes = new Set(result.findings.map((finding) => finding.code));
  for (const code of [
    "robots-noindex",
    "robots-nofollow",
    "title-missing",
    "meta-description-missing",
    "canonical-missing",
    "html-lang-missing",
    "h1-missing",
    "content-thin",
    "image-alt-missing",
    "json-ld-invalid",
  ]) {
    assert.ok(codes.has(code), `missing finding: ${code}`);
  }
  assert.ok(result.score < 25, `expected a low score, received ${result.score}`);
  assert.ok(result.findings.some((finding) => finding.severity === "critical"));
  assert.ok(result.findings.every((finding) => finding.scoreImpact >= 0));
});

test("a complete representative page can earn a score of 100", () => {
  const copy = Array.from({ length: 220 }, (_, index) => `word${index}`).join(" ");
  const result = extractSiteAudit(
    `<html lang="en"><head>
      <title>Marpin Marketing Operating System for Solo Founders</title>
      <meta name="description" content="Build a complete distribution plan, prepare channel-ready content, and review measurable campaigns in one focused marketing workspace.">
      <meta name="robots" content="index,follow">
      <link rel="canonical" href="https://example.com/guide">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
    </head><body>
      <h1>The founder distribution guide</h1><h2>Build the weekly plan</h2>
      <p>${copy}</p><img src="guide.png" alt="Weekly content plan">
    </body></html>`,
    { sourceUrl: "https://example.com/guide", finalUrl: "https://example.com/guide" },
  );

  assert.equal(result.score, 100);
  assert.deepEqual(result.findings, []);
});

test("App Store audits use bounded app metadata instead of Apple-controlled page SEO", () => {
  const result = extractSiteAudit(
    `<html lang="en-US"><head>
      <title>Fitura App - App Store</title>
      <meta name="description" content="Apple's generic storefront description.">
      <link rel="canonical" href="https://apps.apple.com/us/app/fitura/id6743079022">
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "\u200eFitura",
        description: "Fitura turns health goals into a practical weekly plan.\n\nYOUR WEEK, READY TO FOLLOW\n\nBuild a plan around nutrition, movement, sleep, recovery, and daily habits.",
        applicationCategory: "HealthApplication",
        genre: ["Health & Fitness", "Productivity"],
        author: { "@type": "Organization", name: "Gabriel Rahbani Buzed" },
      })}</script>
    </head><body>
      <h1>Fitura</h1><h1>Version History</h1><h1>App Privacy</h1>
      <h2>Ratings and Reviews</h2><p>Apple-controlled navigation and recommendations.</p>
      <img src="app.png" alt="Fitura on the App Store">
    </body></html>`,
    {
      sourceUrl: "https://apps.apple.com/us/app/fitura/id6743079022?platform=watch",
      finalUrl: "https://apps.apple.com/us/app/fitura/id6743079022",
    },
  );

  assert.equal(result.documentType, "apple_app_store");
  assert.deepEqual(result.appStore, {
    appId: "6743079022",
    name: "Fitura",
    description: "Fitura turns health goals into a practical weekly plan. YOUR WEEK, READY TO FOLLOW Build a plan around nutrition, movement, sleep, recovery, and daily habits.",
    valueProposition: "Fitura turns health goals into a practical weekly plan.",
    features: ["Your week, ready to follow"],
    developer: "Gabriel Rahbani Buzed",
    categories: ["Health & Fitness", "Productivity"],
  });
  assert.equal(result.title, "Fitura");
  assert.equal(result.metaDescription, result.appStore?.valueProposition);
  assert.deepEqual(result.headings, {
    h1: ["Fitura"],
    h2: ["Your week, ready to follow"],
    h1Count: 1,
    h2Count: 1,
  });
  assert.equal(result.score, 100);
  assert.deepEqual(result.findings.map((finding) => finding.code), ["app-store-managed-page"]);
  assert.equal(result.findings.some((finding) => finding.code === "h1-multiple"), false);
  assert.equal(result.findings.some((finding) => finding.code === "title-length"), false);
});

test("auditSite follows validated redirects and uses conservative request headers", async () => {
  const requests: Array<{ url: string; addresses: string[]; init: RequestInit }> = [];
  const fetcher: SiteFetch = async (target, init) => {
    const url = target.url.href;
    requests.push({ url, addresses: target.addresses.map((item) => item.address), init });
    if (url === "https://example.com/start") {
      return new Response(null, { status: 302, headers: { location: "/final" } });
    }
    return htmlResponse(
      `<html lang="en"><head><title>Redirect destination page title for Marpin</title></head><body><h1>Final</h1></body></html>`,
    );
  };

  const result = await auditSite("example.com/start", { fetcher, resolver: PUBLIC_DNS });

  assert.equal(result.sourceUrl, "https://example.com/start");
  assert.equal(result.finalUrl, "https://example.com/final");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].addresses, ["93.184.216.34"]);
  assert.deepEqual(requests[1].addresses, ["93.184.216.34"]);
  assert.equal(requests[0].init.redirect, "manual");
  const headers = new Headers(requests[0].init.headers);
  assert.match(headers.get("user-agent") ?? "", /^MarpinSiteAudit\/1\.0/);
  assert.match(headers.get("accept") ?? "", /text\/html/);
});

test("auditSite passes the validated DNS answer to the transport without resolving twice", async () => {
  let resolverCalls = 0;
  let connectedAddress = "";
  const resolver: SiteDnsResolver = async () => {
    resolverCalls += 1;
    return resolverCalls === 1
      ? [{ address: "93.184.216.34", family: 4 }]
      : [{ address: "127.0.0.1", family: 4 }];
  };
  const fetcher: SiteFetch = async (target) => {
    connectedAddress = target.addresses[0]?.address ?? "";
    return htmlResponse("<html><head><title>Safe pinned page</title></head><body><h1>Safe</h1></body></html>");
  };

  await auditSite("https://example.com", { resolver, fetcher });

  assert.equal(resolverCalls, 1);
  assert.equal(connectedAddress, "93.184.216.34");
});

test("auditSite validates a redirect before issuing its next request", async () => {
  let fetchCalls = 0;
  const fetcher: SiteFetch = async () => {
    fetchCalls += 1;
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } });
  };

  await assert.rejects(
    () => auditSite("https://example.com", { fetcher, resolver: PUBLIC_DNS }),
    hasAuditCode("UNSAFE_URL"),
  );
  assert.equal(fetchCalls, 1);
});

test("auditSite rejects a redirect hostname that resolves to a private address", async () => {
  let fetchCalls = 0;
  const fetcher: SiteFetch = async () => {
    fetchCalls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "https://internal.example.com/admin" },
    });
  };
  const resolver: SiteDnsResolver = async (hostname) => [
    { address: hostname === "internal.example.com" ? "10.0.0.9" : "93.184.216.34", family: 4 },
  ];

  await assert.rejects(
    () => auditSite("https://example.com", { fetcher, resolver }),
    hasAuditCode("UNSAFE_URL"),
  );
  assert.equal(fetchCalls, 1);
});

test("auditSite blocks a private DNS answer before fetch", async () => {
  let fetchCalls = 0;
  const fetcher: SiteFetch = async () => {
    fetchCalls += 1;
    return htmlResponse("<html></html>");
  };

  await assert.rejects(
    () =>
      auditSite("https://example.com", {
        fetcher,
        resolver: async () => [{ address: "169.254.169.254", family: 4 }],
      }),
    hasAuditCode("UNSAFE_URL"),
  );
  assert.equal(fetchCalls, 0);
});

test("auditSite requires HTML and enforces declared and streamed size limits", async () => {
  await assert.rejects(
    () =>
      auditSite("https://example.com", {
        resolver: PUBLIC_DNS,
        fetcher: async () => new Response("image", { headers: { "content-type": "image/png" } }),
      }),
    hasAuditCode("NOT_HTML"),
  );

  await assert.rejects(
    () =>
      auditSite("https://example.com", {
        resolver: PUBLIC_DNS,
        maxResponseBytes: 20,
        fetcher: async () =>
          htmlResponse("small", { headers: { "content-type": "text/html", "content-length": "21" } }),
      }),
    hasAuditCode("RESPONSE_TOO_LARGE"),
  );

  await assert.rejects(
    () =>
      auditSite("https://example.com", {
        resolver: PUBLIC_DNS,
        maxResponseBytes: 20,
        fetcher: async () => htmlResponse("<html><body>This body is over twenty bytes.</body></html>"),
      }),
    hasAuditCode("RESPONSE_TOO_LARGE"),
  );
});

test("auditSite returns actionable App Store failures without weakening URL validation", async () => {
  const url = "https://apps.apple.com/us/app/fitura/id6743079022";
  await assert.rejects(
    () => auditSite(url, {
      resolver: PUBLIC_DNS,
      fetcher: async () => htmlResponse("<html><head><title>App Store</title></head></html>"),
    }),
    hasAuditCode("APP_STORE_LISTING_UNAVAILABLE"),
  );
  await assert.rejects(
    () => auditSite(url, {
      resolver: PUBLIC_DNS,
      fetcher: async () => htmlResponse("Not found", { status: 404 }),
    }),
    hasAuditCode("APP_STORE_LISTING_UNAVAILABLE"),
  );

  let fetchCalls = 0;
  await assert.rejects(
    () => auditSite("https://apps.apple.com.attacker.example/us/app/fitura/id6743079022", {
      resolver: async () => [{ address: "127.0.0.1", family: 4 }],
      fetcher: async () => {
        fetchCalls += 1;
        return htmlResponse("<html></html>");
      },
    }),
    hasAuditCode("UNSAFE_URL"),
  );
  assert.equal(fetchCalls, 0);
});

test("auditSite applies one hard timeout to the full operation", async () => {
  const fetcher: SiteFetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
        once: true,
      });
    });

  await assert.rejects(
    () => auditSite("https://example.com", { fetcher, resolver: PUBLIC_DNS, timeoutMs: 20 }),
    hasAuditCode("TIMEOUT"),
  );
});
