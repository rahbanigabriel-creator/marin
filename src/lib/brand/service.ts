import { Prisma, type Brand } from "@prisma/client";

import type { SiteAuditResult } from "@/lib/audit/site";
import { mergeSiteAuditIntoBrand } from "@/lib/brand/audit-merge";
import { prisma } from "@/lib/db";
import type { BrandDto, BrandPromptContext, BrandWriteInput } from "@/lib/brand/types";

const MAX_LIST_ITEMS = 30;
const MAX_ITEM_LENGTH = 300;

function canonicalLocale(value: string): string {
  try {
    const normalized = value.replace(/_/g, "-");
    return Intl.getCanonicalLocales(normalized)[0] ?? normalized;
  } catch {
    throw new Error("Invalid locale");
  }
}

function canonicalTimeZone(value: string): string {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw new Error("Invalid timezone");
  }
}

function cleanText(value: unknown, max = 4_000): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("Expected text value");
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

export function cleanStringList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Expected a list of text values");
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, MAX_ITEM_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
}

export function normalizeBrandWriteInput(input: BrandWriteInput): BrandWriteInput {
  const name = cleanText(input.name, 120);
  if (input.name !== undefined && !name) throw new Error("Brand name is required");

  const locale = cleanText(input.locale, 32);
  const timezone = cleanText(input.timezone, 80);
  const currency = cleanText(input.currency, 12)?.toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) throw new Error("Invalid currency");

  return {
    ...input,
    name: name ?? undefined,
    websiteUrl: cleanText(input.websiteUrl, 2_048),
    summary: cleanText(input.summary, 8_000),
    audience: cleanStringList(input.audience),
    voice: cleanStringList(input.voice),
    offers: cleanStringList(input.offers),
    competitors: cleanStringList(input.competitors),
    proofPoints: cleanStringList(input.proofPoints),
    visualStyle: cleanStringList(input.visualStyle),
    locale: locale ? canonicalLocale(locale) : undefined,
    timezone: timezone ? canonicalTimeZone(timezone) : undefined,
    currency: currency ?? undefined,
  };
}

function jsonList(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toDto(brand: Brand): BrandDto {
  return {
    id: brand.id,
    name: brand.name,
    websiteUrl: brand.websiteUrl,
    isPrimary: brand.isPrimary,
    summary: brand.summary,
    audience: jsonList(brand.audience),
    voice: jsonList(brand.voice),
    offers: jsonList(brand.offers),
    competitors: jsonList(brand.competitors),
    proofPoints: jsonList(brand.proofPoints),
    visualStyle: jsonList(brand.visualStyle),
    locale: brand.locale,
    timezone: brand.timezone,
    currency: brand.currency,
    contextVersion: brand.contextVersion,
    auditSnapshot: brand.auditSnapshot,
    auditedAt: brand.auditedAt?.toISOString() ?? null,
    createdAt: brand.createdAt.toISOString(),
    updatedAt: brand.updatedAt.toISOString(),
  };
}

function toData(input: BrandWriteInput): Prisma.BrandUncheckedUpdateInput {
  const data: Prisma.BrandUncheckedUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.websiteUrl !== undefined) data.websiteUrl = input.websiteUrl;
  if (input.summary !== undefined) data.summary = input.summary;
  if (input.audience !== undefined) data.audience = input.audience;
  if (input.voice !== undefined) data.voice = input.voice;
  if (input.offers !== undefined) data.offers = input.offers;
  if (input.competitors !== undefined) data.competitors = input.competitors;
  if (input.proofPoints !== undefined) data.proofPoints = input.proofPoints;
  if (input.visualStyle !== undefined) data.visualStyle = input.visualStyle;
  if (input.locale !== undefined) data.locale = input.locale;
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.auditSnapshot !== undefined) {
    data.auditSnapshot = input.auditSnapshot === null ? Prisma.DbNull : input.auditSnapshot;
  }
  if (input.auditedAt !== undefined) data.auditedAt = input.auditedAt;
  return data;
}

async function syncWorkspaceDefaults(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  input: BrandWriteInput,
): Promise<void> {
  const data: Prisma.WorkspaceUpdateManyMutationInput = {};
  if (input.locale !== undefined) data.locale = input.locale;
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.currency !== undefined) data.currency = input.currency;
  if (Object.keys(data).length) {
    await tx.workspace.updateMany({ where: { id: workspaceId }, data });
  }
}

export async function listBrands(workspaceId: string): Promise<BrandDto[]> {
  const brands = await prisma.brand.findMany({
    where: { workspaceId },
    orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
  });
  return brands.map(toDto);
}

export async function getBrand(workspaceId: string, brandId: string): Promise<BrandDto | null> {
  const brand = await prisma.brand.findFirst({ where: { id: brandId, workspaceId } });
  return brand ? toDto(brand) : null;
}

export async function getPrimaryBrand(workspaceId: string): Promise<BrandDto | null> {
  const brand = await prisma.brand.findFirst({
    where: { workspaceId, isPrimary: true },
    orderBy: { updatedAt: "desc" },
  });
  return brand ? toDto(brand) : null;
}

export async function getPrimaryBrandPromptContext(
  workspaceId: string,
): Promise<BrandPromptContext | null> {
  const brand = await getPrimaryBrand(workspaceId);
  if (!brand) return null;
  const {
    id,
    name,
    websiteUrl,
    summary,
    audience,
    voice,
    offers,
    competitors,
    proofPoints,
    locale,
    timezone,
    currency,
    contextVersion,
  } = brand;
  return {
    id,
    name,
    websiteUrl,
    summary,
    audience,
    voice,
    offers,
    competitors,
    proofPoints,
    locale,
    timezone,
    currency,
    contextVersion,
  };
}

async function lockWorkspaceForPrimaryBrand(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "workspaces" WHERE "id" = ${workspaceId} FOR UPDATE
  `;
  if (rows.length === 0) throw new Error("Workspace not found");
}

async function findPrimaryBrandCandidate(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  websiteUrl: string | null | undefined,
): Promise<Brand | null> {
  return tx.brand.findFirst({
    where: {
      workspaceId,
      OR: [
        { isPrimary: true },
        ...(websiteUrl ? [{ websiteUrl }] : []),
      ],
    },
    orderBy: { isPrimary: "desc" },
  });
}

async function savePrimaryBrandInLockedTransaction(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  input: BrandWriteInput,
  existing: Brand | null,
): Promise<BrandDto> {
  await tx.brand.updateMany({ where: { workspaceId, isPrimary: true }, data: { isPrimary: false } });
  let saved: Brand;
  if (existing) {
    saved = await tx.brand.update({
      where: { id: existing.id },
      data: { ...toData(input), isPrimary: true, contextVersion: { increment: 1 } },
    });
  } else {
    saved = await tx.brand.create({
      data: {
        workspaceId,
        name: input.name as string,
        websiteUrl: input.websiteUrl,
        summary: input.summary,
        audience: input.audience ?? [],
        voice: input.voice ?? [],
        offers: input.offers ?? [],
        competitors: input.competitors ?? [],
        proofPoints: input.proofPoints ?? [],
        visualStyle: input.visualStyle ?? [],
        locale: input.locale ?? "en",
        timezone: input.timezone ?? "UTC",
        currency: input.currency ?? "EUR",
        auditSnapshot:
          input.auditSnapshot === null ? Prisma.DbNull : input.auditSnapshot,
        auditedAt: input.auditedAt,
        isPrimary: true,
      },
    });
  }
  await syncWorkspaceDefaults(tx, workspaceId, input);
  return toDto(saved);
}

async function upsertPrimaryBrandInTransaction(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  rawInput: BrandWriteInput,
): Promise<BrandDto> {
  const input = normalizeBrandWriteInput(rawInput);
  if (!input.name) throw new Error("Brand name is required");

  await lockWorkspaceForPrimaryBrand(tx, workspaceId);
  const existing = await findPrimaryBrandCandidate(tx, workspaceId, input.websiteUrl);
  return savePrimaryBrandInLockedTransaction(tx, workspaceId, input, existing);
}

/** Applies one server-produced site audit while preserving user-authored brand fields. */
export async function applySiteAuditToPrimaryBrandInTransaction(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  audit: SiteAuditResult,
  auditedAt = new Date(),
): Promise<BrandDto> {
  await lockWorkspaceForPrimaryBrand(tx, workspaceId);
  const existing = await findPrimaryBrandCandidate(tx, workspaceId, audit.finalUrl);
  const input = normalizeBrandWriteInput(
    mergeSiteAuditIntoBrand(existing ? toDto(existing) : null, audit, auditedAt),
  );
  if (!input.name) throw new Error("Brand name is required");
  return savePrimaryBrandInLockedTransaction(tx, workspaceId, input, existing);
}

export async function applySiteAuditToPrimaryBrand(
  workspaceId: string,
  audit: SiteAuditResult,
  auditedAt = new Date(),
): Promise<BrandDto> {
  return prisma.$transaction((tx) =>
    applySiteAuditToPrimaryBrandInTransaction(tx, workspaceId, audit, auditedAt),
  );
}

export async function upsertPrimaryBrand(
  workspaceId: string,
  rawInput: BrandWriteInput,
): Promise<BrandDto> {
  return prisma.$transaction((tx) =>
    upsertPrimaryBrandInTransaction(tx, workspaceId, rawInput),
  );
}

export async function updateBrand(
  workspaceId: string,
  brandId: string,
  rawInput: BrandWriteInput,
): Promise<BrandDto | null> {
  const input = normalizeBrandWriteInput(rawInput);
  const brand = await prisma.$transaction(async (tx) => {
    const existing = await tx.brand.findFirst({ where: { id: brandId, workspaceId } });
    if (!existing) return null;
    const saved = await tx.brand.update({
      where: { id: brandId },
      data: { ...toData(input), contextVersion: { increment: 1 } },
    });
    if (existing.isPrimary) await syncWorkspaceDefaults(tx, workspaceId, input);
    return saved;
  });
  return brand ? toDto(brand) : null;
}
