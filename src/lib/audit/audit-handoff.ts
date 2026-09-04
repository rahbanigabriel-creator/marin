import { createHash, randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";

import {
  appleAppStoreListingId,
  auditSite,
  normalizeSiteUrl,
  type AppStoreListingMetadata,
  type AuditDocumentType,
  type AuditFinding,
  type SiteAuditResult,
} from "@/lib/audit/site";
import {
  applySiteAuditToPrimaryBrand,
  applySiteAuditToPrimaryBrandInTransaction,
} from "@/lib/brand/service";
import type { BrandDto } from "@/lib/brand/types";
import { prisma } from "@/lib/db";

export const AUDIT_HANDOFF_COOKIE_NAME = "marpin_audit_handoff";
export const AUDIT_HANDOFF_TTL_MS = 15 * 60 * 1_000;

const AUDIT_HANDOFF_TOKEN_BYTES = 32;
const AUDIT_HANDOFF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_STORED_AUDIT_BYTES = 512 * 1_024;

export interface AuditHandoffCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  expires: Date;
  maxAge: number;
  priority: "high";
}

export interface IssuedAuditHandoff {
  token: string;
  expiresAt: Date;
}

export interface PersistedWorkspaceAudit {
  audit: SiteAuditResult;
  brand: BrandDto;
  source: "handoff" | "crawl";
}

interface AuditHandoffDependencies {
  now?: () => Date;
  createToken?: () => string;
}

interface PersistWorkspaceAuditDependencies extends AuditHandoffDependencies {
  crawl?: (url: string) => Promise<SiteAuditResult>;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function defaultToken(): string {
  return randomBytes(AUDIT_HANDOFF_TOKEN_BYTES).toString("base64url");
}

export function isAuditHandoffToken(value: string | null | undefined): value is string {
  return typeof value === "string" && AUDIT_HANDOFF_TOKEN_PATTERN.test(value);
}

export function auditHandoffCookieOptions(
  requestUrl: string,
  expiresAt: Date,
  now = new Date(),
): AuditHandoffCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(requestUrl).protocol === "https:",
    path: "/",
    expires: expiresAt,
    maxAge: Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000)),
    priority: "high",
  };
}

export function expiredAuditHandoffCookieOptions(
  requestUrl: string,
): AuditHandoffCookieOptions {
  return {
    ...auditHandoffCookieOptions(requestUrl, new Date(0), new Date(0)),
    expires: new Date(0),
    maxAge: 0,
  };
}

function record(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : null;
}

function boundedString(
  value: Prisma.JsonValue | undefined,
  maxLength: number,
): string | null {
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

function nullableString(
  value: Prisma.JsonValue | undefined,
  maxLength: number,
): string | null | undefined {
  if (value === null) return null;
  const parsed = boundedString(value, maxLength);
  return parsed === null ? undefined : parsed;
}

function stringList(
  value: Prisma.JsonValue | undefined,
  maxItems: number,
  maxItemLength: number,
): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const parsed = value.map((item) => boundedString(item, maxItemLength));
  return parsed.every((item): item is string => item !== null) ? parsed : null;
}

function count(value: Prisma.JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000
    ? value
    : null;
}

function boolean(value: Prisma.JsonValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function finiteNumber(value: Prisma.JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseAppStoreListing(
  value: Prisma.JsonValue | undefined,
  expectedAppId: string,
): AppStoreListingMetadata | null {
  const listing = record(value ?? null);
  if (!listing) return null;
  const appId = boundedString(listing.appId, 32);
  const name = boundedString(listing.name, 240);
  const description = nullableString(listing.description, 4_000);
  const valueProposition = nullableString(listing.valueProposition, 500);
  const features = stringList(listing.features, 12, 120);
  const developer = nullableString(listing.developer, 240);
  const categories = stringList(listing.categories, 20, 120);
  if (
    appId !== expectedAppId ||
    name === null ||
    description === undefined ||
    valueProposition === undefined ||
    !features ||
    developer === undefined ||
    !categories
  ) {
    return null;
  }
  return {
    appId,
    name,
    description,
    valueProposition,
    features,
    developer,
    categories,
  };
}

function parseFindings(value: Prisma.JsonValue | undefined): AuditFinding[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const categories = new Set<AuditFinding["category"]>([
    "indexability",
    "metadata",
    "content",
    "links",
    "images",
    "structured-data",
  ]);
  const severities = new Set<AuditFinding["severity"]>(["critical", "warning", "info"]);
  const findings: AuditFinding[] = [];

  for (const item of value) {
    const entry = record(item);
    if (!entry) return null;
    const code = boundedString(entry.code, 120);
    const category = boundedString(entry.category, 40) as AuditFinding["category"] | null;
    const severity = boundedString(entry.severity, 20) as AuditFinding["severity"] | null;
    const title = boundedString(entry.title, 500);
    const evidence = boundedString(entry.evidence, 4_000);
    const recommendation = boundedString(entry.recommendation, 4_000);
    const scoreImpact = finiteNumber(entry.scoreImpact);
    if (
      code === null ||
      category === null ||
      !categories.has(category) ||
      severity === null ||
      !severities.has(severity) ||
      title === null ||
      evidence === null ||
      recommendation === null ||
      scoreImpact === null ||
      Math.abs(scoreImpact) > 100
    ) {
      return null;
    }
    findings.push({ code, category, severity, title, evidence, recommendation, scoreImpact });
  }
  return findings;
}

function parseStoredAudit(value: Prisma.JsonValue): SiteAuditResult | null {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return null;
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_STORED_AUDIT_BYTES) return null;

  const audit = record(value);
  const headings = audit ? record(audit.headings) : null;
  const links = audit ? record(audit.links) : null;
  const images = audit ? record(audit.images) : null;
  const robots = audit ? record(audit.robots) : null;
  if (!audit || !headings || !links || !images || !robots) return null;

  const rawSourceUrl = boundedString(audit.sourceUrl, 2_048);
  const rawFinalUrl = boundedString(audit.finalUrl, 2_048);
  const title = nullableString(audit.title, 1_000);
  const metaDescription = nullableString(audit.metaDescription, 4_000);
  const canonical = nullableString(audit.canonical, 2_048);
  const lang = nullableString(audit.lang, 80);
  const h1 = stringList(headings.h1, 50, 240);
  const h2 = stringList(headings.h2, 50, 240);
  const h1Count = count(headings.h1Count);
  const h2Count = count(headings.h2Count);
  const wordCount = count(audit.wordCount);
  const linkTotal = count(links.total);
  const linkInternal = count(links.internal);
  const linkExternal = count(links.external);
  const imageTotal = count(images.total);
  const imageWithAlt = count(images.withAlt);
  const imageWithoutAlt = count(images.withoutAlt);
  const robotsRaw = nullableString(robots.raw, 4_000);
  const directives = stringList(robots.directives, 100, 120);
  const indexAllowed = boolean(robots.indexAllowed);
  const followAllowed = boolean(robots.followAllowed);
  const jsonLdTypes = stringList(audit.jsonLdTypes, 100, 240);
  const jsonLdBlockCount = count(audit.jsonLdBlockCount);
  const invalidJsonLdBlockCount = count(audit.invalidJsonLdBlockCount);
  const score = finiteNumber(audit.score);
  const findings = parseFindings(audit.findings);

  if (
    rawSourceUrl === null ||
    rawFinalUrl === null ||
    title === undefined ||
    metaDescription === undefined ||
    canonical === undefined ||
    lang === undefined ||
    !h1 ||
    !h2 ||
    h1Count === null ||
    h2Count === null ||
    wordCount === null ||
    linkTotal === null ||
    linkInternal === null ||
    linkExternal === null ||
    imageTotal === null ||
    imageWithAlt === null ||
    imageWithoutAlt === null ||
    robotsRaw === undefined ||
    !directives ||
    indexAllowed === null ||
    followAllowed === null ||
    !jsonLdTypes ||
    jsonLdBlockCount === null ||
    invalidJsonLdBlockCount === null ||
    score === null ||
    score < 0 ||
    score > 100 ||
    !findings
  ) {
    return null;
  }

  let sourceUrl: string;
  let finalUrl: string;
  try {
    sourceUrl = normalizeSiteUrl(rawSourceUrl).href;
    finalUrl = normalizeSiteUrl(rawFinalUrl).href;
  } catch {
    return null;
  }
  if (sourceUrl !== rawSourceUrl || finalUrl !== rawFinalUrl) return null;

  const inferredDocumentType: AuditDocumentType = appleAppStoreListingId(finalUrl)
    ? "apple_app_store"
    : "website";
  const storedDocumentType = audit.documentType === undefined
    ? inferredDocumentType
    : boundedString(audit.documentType, 40);
  if (storedDocumentType !== inferredDocumentType) return null;
  const appId = appleAppStoreListingId(finalUrl);
  const appStore = appId && audit.appStore !== undefined
    ? parseAppStoreListing(audit.appStore, appId)
    : null;
  if (audit.appStore !== undefined && !appStore) return null;

  return {
    documentType: inferredDocumentType,
    ...(appStore ? { appStore } : {}),
    sourceUrl,
    finalUrl,
    title,
    metaDescription,
    canonical,
    lang,
    headings: { h1, h2, h1Count, h2Count },
    wordCount,
    links: { total: linkTotal, internal: linkInternal, external: linkExternal },
    images: { total: imageTotal, withAlt: imageWithAlt, withoutAlt: imageWithoutAlt },
    robots: { raw: robotsRaw, directives, indexAllowed, followAllowed },
    jsonLdTypes,
    jsonLdBlockCount,
    invalidJsonLdBlockCount,
    score,
    findings,
  };
}

function toStoredAudit(audit: SiteAuditResult): Prisma.InputJsonValue {
  const snapshot = JSON.parse(JSON.stringify(audit)) as Prisma.JsonValue;
  const parsed = parseStoredAudit(snapshot);
  if (!parsed) throw new Error("Site audit result could not be persisted safely");
  return JSON.parse(JSON.stringify(parsed)) as Prisma.InputJsonValue;
}

/** Stores the full server-produced audit and returns the raw token for the cookie only. */
export async function issueAuditHandoff(
  audit: SiteAuditResult,
  dependencies: AuditHandoffDependencies = {},
): Promise<IssuedAuditHandoff> {
  const now = dependencies.now?.() ?? new Date();
  const token = dependencies.createToken?.() ?? defaultToken();
  if (!isAuditHandoffToken(token)) throw new Error("Invalid audit handoff token");
  const finalUrl = normalizeSiteUrl(audit.finalUrl).href;
  if (finalUrl !== audit.finalUrl) throw new Error("Audit final URL is not canonical");
  const expiresAt = new Date(now.getTime() + AUDIT_HANDOFF_TTL_MS);

  await prisma.$transaction(async (tx) => {
    await tx.auditHandoff.deleteMany({ where: { expiresAt: { lte: now } } });
    await tx.auditHandoff.create({
      data: {
        tokenHash: hashToken(token),
        finalUrl,
        auditSnapshot: toStoredAudit(audit),
        expiresAt,
      },
    });
  });

  return { token, expiresAt };
}

async function consumeAuditHandoffIntoWorkspace(input: {
  workspaceId: string;
  requestedFinalUrl: string;
  token: string;
  now: Date;
}): Promise<Omit<PersistedWorkspaceAudit, "source"> | null> {
  if (!isAuditHandoffToken(input.token)) return null;
  const tokenHash = hashToken(input.token);

  return prisma.$transaction(async (tx) => {
    await tx.auditHandoff.deleteMany({ where: { expiresAt: { lte: input.now } } });
    // Prisma binds Dates as timestamptz; expires_at stores UTC without a zone.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "audit_handoffs"
      WHERE "token_hash" = ${tokenHash}
        AND "expires_at" > (${input.now}::timestamptz AT TIME ZONE 'UTC')
      FOR UPDATE
    `;
    const id = locked[0]?.id;
    if (!id) return null;

    const handoff = await tx.auditHandoff.findUnique({ where: { id } });
    if (!handoff) return null;
    const audit = parseStoredAudit(handoff.auditSnapshot);
    if (
      handoff.finalUrl !== input.requestedFinalUrl ||
      !audit ||
      audit.finalUrl !== handoff.finalUrl
    ) {
      await tx.auditHandoff.delete({ where: { id } });
      return null;
    }

    const brand = await applySiteAuditToPrimaryBrandInTransaction(
      tx,
      input.workspaceId,
      audit,
      input.now,
    );
    await tx.auditHandoff.delete({ where: { id } });
    return { audit, brand };
  });
}

/** Reuses a valid one-time handoff or safely performs the existing protected crawl. */
export async function persistWorkspaceAudit(
  input: { workspaceId: string; requestedUrl: string; token?: string | null },
  dependencies: PersistWorkspaceAuditDependencies = {},
): Promise<PersistedWorkspaceAudit> {
  const now = dependencies.now?.() ?? new Date();
  const requestedFinalUrl = normalizeSiteUrl(input.requestedUrl).href;
  const handoff = input.token
    ? await consumeAuditHandoffIntoWorkspace({
        workspaceId: input.workspaceId,
        requestedFinalUrl,
        token: input.token,
        now,
      })
    : null;
  if (handoff) return { ...handoff, source: "handoff" };

  const audit = await (dependencies.crawl ?? auditSite)(requestedFinalUrl);
  const brand = await applySiteAuditToPrimaryBrand(input.workspaceId, audit, now);
  return { audit, brand, source: "crawl" };
}
