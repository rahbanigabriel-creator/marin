import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

import { parse as parseHtml } from "node-html-parser";

export const DEFAULT_AUDIT_TIMEOUT_MS = 12_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_REDIRECTS = 5;

const AUDIT_USER_AGENT =
  "MarpinSiteAudit/1.0 (+https://www.marpin.ai; website audit; contact: support@marpin.ai)";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTML_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const LOCAL_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home", ".lan"];
const HEADING_SUMMARY_LIMIT = 50;
const HEADING_TEXT_LIMIT = 240;

export type AuditSeverity = "critical" | "warning" | "info";

export type SiteAuditErrorCode =
  | "INVALID_URL"
  | "UNSAFE_URL"
  | "DNS_LOOKUP_FAILED"
  | "TIMEOUT"
  | "REDIRECT_ERROR"
  | "TOO_MANY_REDIRECTS"
  | "HTTP_ERROR"
  | "NOT_HTML"
  | "RESPONSE_TOO_LARGE"
  | "FETCH_FAILED";

export class SiteAuditError extends Error {
  readonly code: SiteAuditErrorCode;
  readonly status?: number;

  constructor(code: SiteAuditErrorCode, message: string, options?: { cause?: unknown; status?: number }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SiteAuditError";
    this.code = code;
    this.status = options?.status;
  }
}

export interface DnsAddress {
  address: string;
  family?: number;
}

export type SiteDnsResolver = (hostname: string) => Promise<readonly DnsAddress[]>;
export interface ValidatedSiteTarget {
  /** The original public URL. It remains the HTTP Host and TLS SNI name. */
  url: URL;
  /** Public addresses returned by the validation lookup for this exact request. */
  addresses: readonly DnsAddress[];
}

/**
 * A transport receives the already-validated addresses so it can connect to one
 * of those exact addresses instead of resolving the hostname a second time.
 */
export type SiteFetch = (target: ValidatedSiteTarget, init: RequestInit) => Promise<Response>;

export interface SiteAuditOptions {
  fetcher?: SiteFetch;
  resolver?: SiteDnsResolver;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
}

export interface AuditFinding {
  code: string;
  category: "indexability" | "metadata" | "content" | "links" | "images" | "structured-data";
  severity: AuditSeverity;
  title: string;
  evidence: string;
  recommendation: string;
  scoreImpact: number;
}

export interface SiteAuditResult {
  sourceUrl: string;
  finalUrl: string;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  lang: string | null;
  headings: {
    h1: string[];
    h2: string[];
    h1Count: number;
    h2Count: number;
  };
  wordCount: number;
  links: {
    total: number;
    internal: number;
    external: number;
  };
  images: {
    total: number;
    withAlt: number;
    withoutAlt: number;
  };
  robots: {
    raw: string | null;
    directives: string[];
    indexAllowed: boolean;
    followAllowed: boolean;
  };
  jsonLdTypes: string[];
  jsonLdBlockCount: number;
  invalidJsonLdBlockCount: number;
  score: number;
  findings: AuditFinding[];
}

interface ParsedHtmlElement {
  textContent: string;
  structuredText: string;
  querySelector(selector: string): ParsedHtmlElement | null;
  querySelectorAll(selector: string): ParsedHtmlElement[];
  getAttribute(name: string): string | undefined;
  remove(): void;
}

type HtmlParser = (
  html: string,
  options?: {
    comment?: boolean;
    lowerCaseTagName?: boolean;
    blockTextElements?: Record<string, boolean>;
  },
) => ParsedHtmlElement;

type AuditSignals = Omit<SiteAuditResult, "score" | "findings">;

interface Deadline {
  run<T>(operation: Promise<T>): Promise<T>;
  clear(): void;
  didExpire(): boolean;
}

const defaultResolver: SiteDnsResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

const defaultFetcher: SiteFetch = (target, init) => pinnedNodeFetch(target, init);

/**
 * Accepts a hostname or URL-like value and returns a canonical HTTP(S) URL.
 * Fragments are removed because they are never sent to the audited server.
 */
export function normalizeSiteUrl(input: string | URL): URL {
  const original = input instanceof URL ? input.href : input.trim();
  if (!original) {
    throw new SiteAuditError("INVALID_URL", "Enter a website URL.");
  }

  let candidate = original;
  if (candidate.startsWith("//")) {
    candidate = `https:${candidate}`;
  } else if (!/^https?:\/\//i.test(candidate)) {
    const scheme = candidate.match(/^([a-z][a-z\d+.-]*):/i)?.[1];
    if (scheme && !scheme.includes(".")) {
      throw new SiteAuditError("INVALID_URL", "Only HTTP and HTTPS website URLs are supported.");
    }
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch (error) {
    throw new SiteAuditError("INVALID_URL", "Enter a valid website URL.", { cause: error });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SiteAuditError("INVALID_URL", "Only HTTP and HTTPS website URLs are supported.");
  }
  if (url.username || url.password) {
    throw new SiteAuditError("UNSAFE_URL", "Website URLs cannot contain credentials.");
  }
  if (!url.hostname) {
    throw new SiteAuditError("INVALID_URL", "The website URL must include a hostname.");
  }

  assertSafeHostname(url.hostname);
  url.hash = "";
  return url;
}

/** Resolve a URL and reject it if any returned address is not globally routable. */
export async function validatePublicSiteUrl(
  input: string | URL,
  resolver: SiteDnsResolver = defaultResolver,
): Promise<URL> {
  return (await resolvePublicSiteTarget(input, resolver)).url;
}

/** Resolve, validate, and retain the addresses that the transport must use. */
export async function resolvePublicSiteTarget(
  input: string | URL,
  resolver: SiteDnsResolver = defaultResolver,
): Promise<ValidatedSiteTarget> {
  const url = normalizeSiteUrl(input);
  const hostname = normalizedHostname(url.hostname);

  if (isIP(hostname)) {
    return { url, addresses: [{ address: hostname, family: isIP(hostname) }] };
  }

  let addresses: readonly DnsAddress[];
  try {
    addresses = await resolver(hostname);
  } catch (error) {
    throw new SiteAuditError("DNS_LOOKUP_FAILED", `Could not resolve ${hostname}.`, { cause: error });
  }

  if (addresses.length === 0) {
    throw new SiteAuditError("DNS_LOOKUP_FAILED", `${hostname} did not resolve to an IP address.`);
  }

  for (const { address } of addresses) {
    if (!isPublicIpAddress(address)) {
      throw new SiteAuditError(
        "UNSAFE_URL",
        `${hostname} resolves to a non-public network address and cannot be audited.`,
      );
    }
  }

  return {
    url,
    addresses: addresses.map(({ address, family }) => ({
      address: address.split("%")[0],
      family: family ?? isIP(address.split("%")[0]),
    })),
  };
}

/**
 * Fetch through Node's HTTP stack with DNS pinned to the validated answer. The
 * URL hostname is still used for Host and TLS certificate/SNI verification; only
 * socket address selection is replaced. This closes the validate-then-resolve
 * DNS-rebinding gap present in a plain global fetch().
 */
function pinnedNodeFetch(target: ValidatedSiteTarget, init: RequestInit): Promise<Response> {
  const pinned = target.addresses[0];
  if (!pinned) {
    return Promise.reject(new SiteAuditError("DNS_LOOKUP_FAILED", "No validated address is available."));
  }
  const address = pinned.address.split("%")[0];
  const family = pinned.family ?? isIP(address);
  if ((family !== 4 && family !== 6) || !isPublicIpAddress(address)) {
    return Promise.reject(new SiteAuditError("UNSAFE_URL", "The validated address is not public."));
  }

  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };

  return new Promise<Response>((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const request = (target.url.protocol === "https:" ? httpsRequest : httpRequest)(
      target.url,
      {
        method: init.method ?? "GET",
        headers,
        lookup: pinnedLookup,
        signal: init.signal ?? undefined,
      },
      (incoming) => {
        const responseHeaders = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
          const name = incoming.rawHeaders[index];
          const value = incoming.rawHeaders[index + 1];
          if (name && value !== undefined) responseHeaders.append(name, value);
        }
        const status = incoming.statusCode ?? 502;
        const body =
          status === 204 || status === 304
            ? null
            : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
        resolve(
          new Response(body, {
            status,
            statusText: incoming.statusMessage,
            headers: responseHeaders,
          }),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });
}

/** Returns true only for globally routable IPv4 and IPv6 addresses. */
export function isPublicIpAddress(input: string): boolean {
  const address = input.split("%")[0].toLowerCase();
  const family = isIP(address);

  if (family === 4) {
    const value = ipv4ToNumber(address);
    return value !== null && !BLOCKED_IPV4_RANGES.some(([base, prefix]) => inIpv4Cidr(value, base, prefix));
  }

  if (family !== 6) return false;
  const value = ipv6ToBigInt(address);
  if (value === null) return false;

  const mappedV4Prefix = ipv6ToBigInt("::ffff:0:0");
  if (mappedV4Prefix !== null && inIpv6Cidr(value, mappedV4Prefix, 96)) {
    return !BLOCKED_IPV4_RANGES.some(([base, prefix]) =>
      inIpv4Cidr(Number(value & 0xffffffffn), base, prefix),
    );
  }

  const nat64Prefix = ipv6ToBigInt("64:ff9b::");
  if (nat64Prefix !== null && inIpv6Cidr(value, nat64Prefix, 96)) {
    return !BLOCKED_IPV4_RANGES.some(([base, prefix]) =>
      inIpv4Cidr(Number(value & 0xffffffffn), base, prefix),
    );
  }

  return !BLOCKED_IPV6_RANGES.some(([base, prefix]) => {
    const rangeBase = ipv6ToBigInt(base);
    return rangeBase !== null && inIpv6Cidr(value, rangeBase, prefix);
  });
}

/** Fetches and audits one page. Redirect destinations are revalidated before every request. */
export async function auditSite(input: string | URL, options: SiteAuditOptions = {}): Promise<SiteAuditResult> {
  const sourceUrl = normalizeSiteUrl(input);
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_AUDIT_TIMEOUT_MS, "timeoutMs");
  const maxResponseBytes = positiveInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    "maxResponseBytes",
  );
  const maxRedirects = nonNegativeInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS, "maxRedirects");
  const resolver = options.resolver ?? defaultResolver;
  const fetcher = options.fetcher ?? defaultFetcher;
  const abortController = new AbortController();
  const deadline = createDeadline(timeoutMs, abortController);

  try {
    let currentUrl = sourceUrl;
    let redirects = 0;

    while (true) {
      const target = await deadline.run(resolvePublicSiteTarget(currentUrl, resolver));
      currentUrl = target.url;

      let response: Response;
      try {
        response = await deadline.run(
          fetcher(target, {
            method: "GET",
            redirect: "manual",
            signal: abortController.signal,
            headers: {
              Accept: "text/html,application/xhtml+xml;q=0.9",
              "Accept-Language": "en;q=0.8,*;q=0.5",
              "Cache-Control": "no-cache",
              "User-Agent": AUDIT_USER_AGENT,
            },
          }),
        );
      } catch (error) {
        if (error instanceof SiteAuditError) throw error;
        if (deadline.didExpire() || abortController.signal.aborted) {
          throw new SiteAuditError("TIMEOUT", `The website audit exceeded ${timeoutMs}ms.`, { cause: error });
        }
        throw new SiteAuditError("FETCH_FAILED", `Could not fetch ${currentUrl.hostname}.`, { cause: error });
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        if (redirects >= maxRedirects) {
          throw new SiteAuditError(
            "TOO_MANY_REDIRECTS",
            `The website exceeded the ${maxRedirects}-redirect limit.`,
          );
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new SiteAuditError("REDIRECT_ERROR", `HTTP ${response.status} did not include a Location header.`, {
            status: response.status,
          });
        }

        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch (error) {
          throw new SiteAuditError("REDIRECT_ERROR", "The website returned an invalid redirect URL.", {
            cause: error,
            status: response.status,
          });
        }
        currentUrl = normalizeSiteUrl(nextUrl);
        redirects += 1;
        continue;
      }

      if (!response.ok) {
        throw new SiteAuditError("HTTP_ERROR", `The website returned HTTP ${response.status}.`, {
          status: response.status,
        });
      }

      const contentTypeHeader = response.headers.get("content-type") ?? "";
      const contentType = contentTypeHeader.split(";", 1)[0].trim().toLowerCase();
      if (!HTML_CONTENT_TYPES.has(contentType)) {
        throw new SiteAuditError(
          "NOT_HTML",
          `Expected an HTML response but received ${contentType || "no Content-Type"}.`,
          { status: response.status },
        );
      }

      const html = await readBoundedHtml(response, maxResponseBytes, contentTypeHeader, deadline);
      return extractSiteAudit(html, { sourceUrl, finalUrl: currentUrl });
    }
  } catch (error) {
    if (error instanceof SiteAuditError) throw error;
    if (deadline.didExpire()) {
      throw new SiteAuditError("TIMEOUT", `The website audit exceeded ${timeoutMs}ms.`, { cause: error });
    }
    throw new SiteAuditError("FETCH_FAILED", "The website audit failed.", { cause: error });
  } finally {
    deadline.clear();
  }
}

/** Parse already-fetched HTML into deterministic audit signals, findings, and a 0-100 score. */
export function extractSiteAudit(
  html: string,
  urls: { sourceUrl: string | URL; finalUrl?: string | URL },
): SiteAuditResult {
  const sourceUrl = normalizeSiteUrl(urls.sourceUrl);
  const finalUrl = normalizeSiteUrl(urls.finalUrl ?? sourceUrl);
  const root = (parseHtml as HtmlParser)(html, {
    comment: false,
    lowerCaseTagName: true,
    blockTextElements: { script: true, style: true, pre: true },
  });

  const baseUrl = resolveDocumentBase(root, finalUrl);
  const title = cleanText(root.querySelector("title")?.textContent);
  const metaDescription = findMetaContent(root, "description");
  const canonical = findCanonical(root, baseUrl);
  const lang = cleanText(root.querySelector("html")?.getAttribute("lang"))?.toLowerCase() ?? null;
  const h1Elements = root.querySelectorAll("h1");
  const h2Elements = root.querySelectorAll("h2");
  const robots = extractRobots(root);
  const jsonLd = extractJsonLd(root);
  const links = countLinks(root, baseUrl, finalUrl);
  const images = countImages(root);
  const wordCount = countVisibleWords(root);

  const signals: AuditSignals = {
    sourceUrl: sourceUrl.href,
    finalUrl: finalUrl.href,
    title,
    metaDescription,
    canonical,
    lang,
    headings: {
      h1: summarizeHeadings(h1Elements),
      h2: summarizeHeadings(h2Elements),
      h1Count: h1Elements.length,
      h2Count: h2Elements.length,
    },
    wordCount,
    links,
    images,
    robots,
    jsonLdTypes: jsonLd.types,
    jsonLdBlockCount: jsonLd.blockCount,
    invalidJsonLdBlockCount: jsonLd.invalidBlockCount,
  };
  const assessment = assessSiteSignals(signals);

  return { ...signals, ...assessment };
}

export function assessSiteSignals(
  signals: AuditSignals,
): Pick<SiteAuditResult, "score" | "findings"> {
  const findings: AuditFinding[] = [];
  let score = 100;

  const addFinding = (finding: Omit<AuditFinding, "scoreImpact"> & { scoreImpact?: number }) => {
    const scoreImpact = Math.max(0, Math.round(finding.scoreImpact ?? 0));
    score -= scoreImpact;
    findings.push({ ...finding, scoreImpact });
  };

  if (!signals.robots.indexAllowed) {
    addFinding({
      code: "robots-noindex",
      category: "indexability",
      severity: "critical",
      title: "Page is blocked from search indexing",
      evidence: `Robots directives: ${signals.robots.raw ?? "noindex"}.`,
      recommendation: "Remove the noindex directive if this page should appear in organic search.",
      scoreImpact: 25,
    });
  }
  if (!signals.robots.followAllowed) {
    addFinding({
      code: "robots-nofollow",
      category: "indexability",
      severity: "warning",
      title: "Page links are marked nofollow",
      evidence: `Robots directives: ${signals.robots.raw ?? "nofollow"}.`,
      recommendation: "Remove the page-level nofollow directive unless search engines should ignore every link.",
      scoreImpact: 5,
    });
  }

  if (!signals.title) {
    addFinding({
      code: "title-missing",
      category: "metadata",
      severity: "critical",
      title: "Page title is missing",
      evidence: "No non-empty <title> element was found.",
      recommendation: "Add a unique, descriptive title that explains the page in roughly 30-60 characters.",
      scoreImpact: 18,
    });
  } else if (signals.title.length < 30 || signals.title.length > 60) {
    addFinding({
      code: "title-length",
      category: "metadata",
      severity: "warning",
      title: "Page title length needs attention",
      evidence: `The title is ${signals.title.length} characters long; the review range is 30-60.`,
      recommendation: "Rewrite the title so its topic and value remain clear in typical search results.",
      scoreImpact: 5,
    });
  }

  if (!signals.metaDescription) {
    addFinding({
      code: "meta-description-missing",
      category: "metadata",
      severity: "warning",
      title: "Meta description is missing",
      evidence: "No non-empty meta description was found.",
      recommendation: "Add a specific description that earns the click and accurately summarizes this page.",
      scoreImpact: 12,
    });
  } else if (signals.metaDescription.length < 70 || signals.metaDescription.length > 160) {
    addFinding({
      code: "meta-description-length",
      category: "metadata",
      severity: "warning",
      title: "Meta description length needs attention",
      evidence: `The description is ${signals.metaDescription.length} characters long; the review range is 70-160.`,
      recommendation: "Make the description concise, specific, and complete enough to support a search result snippet.",
      scoreImpact: 4,
    });
  }

  if (!signals.canonical) {
    addFinding({
      code: "canonical-missing",
      category: "indexability",
      severity: "warning",
      title: "Canonical URL is missing",
      evidence: "No valid HTTP(S) rel=canonical link was found.",
      recommendation: "Add a self-referencing canonical, or point to the preferred equivalent URL.",
      scoreImpact: 8,
    });
  } else if (!sameSite(new URL(signals.canonical), new URL(signals.finalUrl))) {
    addFinding({
      code: "canonical-cross-site",
      category: "indexability",
      severity: "warning",
      title: "Canonical points to another site",
      evidence: `Canonical: ${signals.canonical}.`,
      recommendation: "Confirm this cross-site canonical is intentional; otherwise use the preferred URL on this site.",
      scoreImpact: 8,
    });
  }

  if (!signals.lang) {
    addFinding({
      code: "html-lang-missing",
      category: "content",
      severity: "info",
      title: "Document language is not declared",
      evidence: "The <html> element has no non-empty lang attribute.",
      recommendation: "Set the html lang attribute to the page's primary language.",
      scoreImpact: 3,
    });
  }

  if (signals.headings.h1Count === 0) {
    addFinding({
      code: "h1-missing",
      category: "content",
      severity: "critical",
      title: "Primary heading is missing",
      evidence: "No <h1> element was found.",
      recommendation: "Add one clear H1 that states the page's primary topic.",
      scoreImpact: 12,
    });
  } else if (signals.headings.h1Count > 1) {
    addFinding({
      code: "h1-multiple",
      category: "content",
      severity: "warning",
      title: "Page has multiple primary headings",
      evidence: `${signals.headings.h1Count} H1 elements were found.`,
      recommendation: "Use one dominant H1 and move supporting section titles to lower heading levels.",
      scoreImpact: 5,
    });
  }

  if (signals.headings.h2Count === 0 && signals.wordCount >= 300) {
    addFinding({
      code: "h2-missing",
      category: "content",
      severity: "info",
      title: "Long page has no section headings",
      evidence: `${signals.wordCount} visible words were found without an H2.`,
      recommendation: "Break the page into scannable sections with descriptive H2 headings.",
      scoreImpact: 2,
    });
  }

  if (signals.wordCount < 200) {
    addFinding({
      code: "content-thin",
      category: "content",
      severity: "info",
      title: "Page has limited visible copy",
      evidence: `${signals.wordCount} visible words were found.`,
      recommendation: "Confirm the page fully answers its visitor's intent; add useful copy where the experience is too thin.",
      scoreImpact: 5,
    });
  }

  if (signals.images.withoutAlt > 0) {
    const ratio = signals.images.withoutAlt / signals.images.total;
    addFinding({
      code: "image-alt-missing",
      category: "images",
      severity: "warning",
      title: "Images are missing alt attributes",
      evidence: `${signals.images.withoutAlt} of ${signals.images.total} images have no alt attribute.`,
      recommendation: "Add meaningful alt text to informative images and an empty alt attribute to decorative images.",
      scoreImpact: Math.min(10, 2 + ratio * 8),
    });
  }

  if (signals.invalidJsonLdBlockCount > 0) {
    addFinding({
      code: "json-ld-invalid",
      category: "structured-data",
      severity: "warning",
      title: "JSON-LD markup is invalid",
      evidence: `${signals.invalidJsonLdBlockCount} of ${signals.jsonLdBlockCount} JSON-LD blocks could not be parsed.`,
      recommendation: "Correct the JSON syntax and validate the markup against the relevant Schema.org type.",
      scoreImpact: 4,
    });
  } else if (signals.jsonLdBlockCount === 0) {
    addFinding({
      code: "json-ld-absent",
      category: "structured-data",
      severity: "info",
      title: "No JSON-LD structured data was found",
      evidence: "The page contains no application/ld+json script block.",
      recommendation: "Add relevant structured data only when it accurately describes visible page content.",
    });
  }

  return { score: Math.max(0, Math.min(100, score)), findings };
}

const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [ipv4Literal("0.0.0.0"), 8],
  [ipv4Literal("10.0.0.0"), 8],
  [ipv4Literal("100.64.0.0"), 10],
  [ipv4Literal("127.0.0.0"), 8],
  [ipv4Literal("169.254.0.0"), 16],
  [ipv4Literal("172.16.0.0"), 12],
  [ipv4Literal("192.0.0.0"), 24],
  [ipv4Literal("192.0.2.0"), 24],
  [ipv4Literal("192.88.99.0"), 24],
  [ipv4Literal("192.168.0.0"), 16],
  [ipv4Literal("198.18.0.0"), 15],
  [ipv4Literal("198.51.100.0"), 24],
  [ipv4Literal("203.0.113.0"), 24],
  [ipv4Literal("224.0.0.0"), 4],
  [ipv4Literal("240.0.0.0"), 4],
];

const BLOCKED_IPV6_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3ffe::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

function assertSafeHostname(input: string): void {
  const hostname = normalizedHostname(input);
  const family = isIP(hostname);
  if (family > 0) {
    if (!isPublicIpAddress(hostname)) {
      throw new SiteAuditError(
        "UNSAFE_URL",
        "Private, loopback, link-local, and reserved IP addresses cannot be audited.",
      );
    }
    return;
  }

  if (
    hostname === "localhost" ||
    !hostname.includes(".") ||
    LOCAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new SiteAuditError("UNSAFE_URL", "Local and private hostnames cannot be audited.");
  }
}

function normalizedHostname(input: string): string {
  const withoutBrackets = input.startsWith("[") && input.endsWith("]") ? input.slice(1, -1) : input;
  return withoutBrackets.replace(/\.$/, "").toLowerCase();
}

function ipv4ToNumber(address: string): number | null {
  const octets = address.split(".");
  if (octets.length !== 4) return null;
  let value = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null;
    const part = Number(octet);
    if (part < 0 || part > 255) return null;
    value = value * 256 + part;
  }
  return value;
}

function ipv4Literal(address: string): number {
  const value = ipv4ToNumber(address);
  if (value === null) throw new Error(`Invalid internal IPv4 literal: ${address}`);
  return value;
}

function inIpv4Cidr(value: number, base: number, prefix: number): boolean {
  const size = 2 ** (32 - prefix);
  return value >= base && value < base + size;
}

function ipv6ToBigInt(input: string): bigint | null {
  let address = input.split("%")[0].toLowerCase();
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    const v4 = ipv4ToNumber(address.slice(lastColon + 1));
    if (lastColon < 0 || v4 === null) return null;
    address = `${address.slice(0, lastColon)}:${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  if (address.split("::").length > 2) return null;
  const [leftRaw, rightRaw] = address.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  const hasCompression = address.includes("::");
  const missing = 8 - left.length - right.length;
  if ((!hasCompression && missing !== 0) || (hasCompression && missing < 1)) return null;

  const groups = hasCompression ? [...left, ...Array<string>(missing).fill("0"), ...right] : left;
  if (groups.length !== 8 || groups.some((group) => !/^[\da-f]{1,4}$/.test(group))) return null;

  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function inIpv6Cidr(value: bigint, base: bigint, prefix: number): boolean {
  if (prefix === 0) return true;
  const shift = BigInt(128 - prefix);
  return value >> shift === base >> shift;
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return resolved;
}

function nonNegativeInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new TypeError(`${name} must be a non-negative integer.`);
  }
  return resolved;
}

function createDeadline(timeoutMs: number, controller: AbortController): Deadline {
  let expired = false;
  let rejectTimeout: ((reason: SiteAuditError) => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
    rejectTimeout?.(new SiteAuditError("TIMEOUT", `The website audit exceeded ${timeoutMs}ms.`));
  }, timeoutMs);

  return {
    run: <T>(operation: Promise<T>) => Promise.race([operation, timeout]),
    clear: () => clearTimeout(timer),
    didExpire: () => expired,
  };
}

async function readBoundedHtml(
  response: Response,
  maxBytes: number,
  contentType: string,
  deadline: Deadline,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new SiteAuditError(
      "RESPONSE_TOO_LARGE",
      `The HTML response exceeds the ${maxBytes}-byte audit limit.`,
      { status: response.status },
    );
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await deadline.run(reader.read());
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel("response size limit exceeded");
        } catch {
          // Preserve the deterministic size error even if the transport rejects cancellation.
        }
        throw new SiteAuditError(
          "RESPONSE_TOO_LARGE",
          `The HTML response exceeds the ${maxBytes}-byte audit limit.`,
          { status: response.status },
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const charset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

function cleanText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function findMetaContent(root: ParsedHtmlElement, name: string): string | null {
  for (const meta of root.querySelectorAll("meta")) {
    if (meta.getAttribute("name")?.trim().toLowerCase() === name) {
      const content = cleanText(meta.getAttribute("content"));
      if (content) return content;
    }
  }
  return null;
}

function resolveDocumentBase(root: ParsedHtmlElement, finalUrl: URL): URL {
  const rawBase = root.querySelector("base")?.getAttribute("href");
  if (!rawBase) return finalUrl;
  const resolved = resolveHttpReference(rawBase, finalUrl);
  return resolved ? new URL(resolved) : finalUrl;
}

function findCanonical(root: ParsedHtmlElement, baseUrl: URL): string | null {
  for (const link of root.querySelectorAll("link")) {
    const rel = link.getAttribute("rel")?.toLowerCase().split(/\s+/) ?? [];
    if (!rel.includes("canonical")) continue;
    const href = link.getAttribute("href");
    if (!href) continue;
    const canonical = resolveHttpReference(href, baseUrl);
    if (canonical) return canonical;
  }
  return null;
}

function resolveHttpReference(reference: string, baseUrl: URL): string | null {
  try {
    const resolved = new URL(reference, baseUrl);
    if ((resolved.protocol !== "http:" && resolved.protocol !== "https:") || resolved.username || resolved.password) {
      return null;
    }
    resolved.hash = "";
    return resolved.href;
  } catch {
    return null;
  }
}

function summarizeHeadings(elements: ParsedHtmlElement[]): string[] {
  const summaries: string[] = [];
  for (const element of elements.slice(0, HEADING_SUMMARY_LIMIT)) {
    const text = cleanText(element.textContent) ?? "";
    summaries.push(text.length > HEADING_TEXT_LIMIT ? `${text.slice(0, HEADING_TEXT_LIMIT - 3)}...` : text);
  }
  return summaries;
}

function countLinks(root: ParsedHtmlElement, baseUrl: URL, finalUrl: URL): SiteAuditResult["links"] {
  let internal = 0;
  let external = 0;

  for (const anchor of root.querySelectorAll("a")) {
    const rawHref = anchor.getAttribute("href")?.trim();
    if (!rawHref || rawHref.startsWith("#")) continue;
    const resolved = resolveHttpReference(rawHref, baseUrl);
    if (!resolved) continue;
    if (sameSite(new URL(resolved), finalUrl)) internal += 1;
    else external += 1;
  }

  return { total: internal + external, internal, external };
}

function sameSite(left: URL, right: URL): boolean {
  const siteHostname = (url: URL) => normalizedHostname(url.hostname).replace(/^www\./, "");
  return siteHostname(left) === siteHostname(right);
}

function countImages(root: ParsedHtmlElement): SiteAuditResult["images"] {
  const images = root.querySelectorAll("img");
  const withAlt = images.filter((image) => image.getAttribute("alt") !== undefined).length;
  return { total: images.length, withAlt, withoutAlt: images.length - withAlt };
}

function extractRobots(root: ParsedHtmlElement): SiteAuditResult["robots"] {
  const values: string[] = [];
  for (const meta of root.querySelectorAll("meta")) {
    if (meta.getAttribute("name")?.trim().toLowerCase() !== "robots") continue;
    const content = cleanText(meta.getAttribute("content"));
    if (content) values.push(content);
  }

  const directives = Array.from(
    new Set(
      values
        .flatMap((value) => value.toLowerCase().split(/[\s,]+/))
        .map((directive) => directive.trim())
        .filter(Boolean),
    ),
  );
  const hasNone = directives.includes("none");
  return {
    raw: values.length > 0 ? values.join(", ") : null,
    directives,
    indexAllowed: !hasNone && !directives.includes("noindex"),
    followAllowed: !hasNone && !directives.includes("nofollow"),
  };
}

function extractJsonLd(root: ParsedHtmlElement): {
  types: string[];
  blockCount: number;
  invalidBlockCount: number;
} {
  const types = new Set<string>();
  let blockCount = 0;
  let invalidBlockCount = 0;

  for (const script of root.querySelectorAll("script")) {
    const type = script.getAttribute("type")?.split(";", 1)[0].trim().toLowerCase();
    if (type !== "application/ld+json") continue;
    blockCount += 1;
    try {
      collectJsonLdTypes(JSON.parse(script.textContent), types, new Set<object>());
    } catch {
      invalidBlockCount += 1;
    }
  }

  return { types: [...types].sort(), blockCount, invalidBlockCount };
}

function collectJsonLdTypes(value: unknown, types: Set<string>, seen: Set<object>): void {
  if (!value || typeof value !== "object" || seen.has(value as object)) return;
  seen.add(value as object);

  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdTypes(item, types, seen);
    return;
  }

  const record = value as Record<string, unknown>;
  const schemaType = record["@type"];
  if (typeof schemaType === "string" && schemaType.trim()) types.add(schemaType.trim());
  if (Array.isArray(schemaType)) {
    for (const item of schemaType) {
      if (typeof item === "string" && item.trim()) types.add(item.trim());
    }
  }

  for (const nested of Object.values(record)) collectJsonLdTypes(nested, types, seen);
}

function countVisibleWords(root: ParsedHtmlElement): number {
  for (const tag of ["script", "style", "noscript", "template", "svg", "head"]) {
    for (const element of root.querySelectorAll(tag)) element.remove();
  }
  const visibleText = cleanText(root.querySelector("body")?.structuredText ?? root.structuredText) ?? "";
  if (!visibleText) return 0;

  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    let words = 0;
    for (const segment of segmenter.segment(visibleText)) {
      if (segment.isWordLike) words += 1;
    }
    return words;
  }

  return visibleText.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}
