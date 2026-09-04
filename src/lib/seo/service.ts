import { createHash } from "node:crypto";

import type {
  Prisma,
  SeoProposal,
  SeoTask,
} from "@prisma/client";

import type { WorkspaceRole } from "@/lib/auth";
import { WorkspaceAuthorizationError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildSeoSources,
  deriveSeoTasks,
  selectSeoEvidenceSources,
  toSeoEvidenceDtos,
} from "@/lib/seo/evidence";
import {
  SeoConflictError,
  SeoNotFoundError,
  SeoValidationError,
} from "@/lib/seo/errors";
import type {
  CreateSeoTaskInput,
  PatchSeoTaskInput,
  SeoProposalDto,
  SeoSeverity,
  SeoTaskDto,
  SeoTaskStatus,
  SeoWorkspaceDto,
} from "@/lib/seo/types";

type SeoTaskWithProposals = Prisma.SeoTaskGetPayload<{
  include: { proposals: true };
}>;

export function canManageSeo(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin";
}

function requireSeoManager(role: WorkspaceRole): void {
  if (!canManageSeo(role)) throw new WorkspaceAuthorizationError();
}

function taskStatus(value: string): SeoTaskStatus {
  return value === "in_progress" || value === "completed" || value === "dismissed"
    ? value
    : "open";
}

function taskSeverity(value: string): SeoSeverity {
  return value === "critical" || value === "high" || value === "low" ? value : "medium";
}

export function toSeoProposalDto(row: SeoProposal): SeoProposalDto {
  return {
    id: row.id,
    taskId: row.taskId,
    fields: { recommendedFix: row.recommendedFix },
    provider: row.provider,
    model: row.model,
    status: row.status === "accepted" ? "accepted" : "proposed",
    createdAt: row.createdAt.toISOString(),
  };
}

export function toSeoTaskDto(row: SeoTaskWithProposals): SeoTaskDto {
  return {
    id: row.id,
    source:
      row.origin === "crawl" || row.origin === "search_console" || row.origin === "ga4"
        ? row.origin
        : "manual",
    category: row.category.slice(0, 80),
    severity: taskSeverity(row.severity),
    priority: row.priority,
    title: row.title,
    description: row.description ?? "",
    recommendedFix: row.recommendedFix ?? "",
    status: taskStatus(row.status),
    verificationStatus: "unverified",
    evidence: toSeoEvidenceDtos(row.evidence),
    completionNote: row.completionNote,
    completedAt: row.completedAt?.toISOString() ?? null,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function sortTasks(tasks: SeoTaskDto[]): SeoTaskDto[] {
  return tasks.sort((left, right) =>
    left.priority - right.priority ||
    left.status.localeCompare(right.status) ||
    right.updatedAt.localeCompare(left.updatedAt));
}

function isPrismaUniqueConflict(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002",
  );
}

async function findBrand(workspaceId: string, brandId: string) {
  const brand = await prisma.brand.findFirst({
    where: { id: brandId, workspaceId },
  });
  if (!brand) throw new SeoNotFoundError("brand");
  return brand;
}

async function loadSeoEvidence(workspaceId: string, websiteUrl: string | null) {
  const connections = await prisma.connection.findMany({
    where: {
      workspaceId,
      platform: { in: ["search_console", "ga4"] },
    },
    select: {
      id: true,
      platform: true,
      status: true,
      externalAccountId: true,
      displayName: true,
    },
  });
  const connectedIds = connections
    .filter((connection) => connection.status === "connected")
    .map((connection) => connection.id);
  const facts = connectedIds.length
    ? await prisma.metricFact.findMany({
        where: {
          workspaceId,
          platform: { in: ["search_console", "ga4"] },
          connectionId: { in: connectedIds },
          staleAt: null,
        },
        select: {
          connectionId: true,
          platform: true,
          date: true,
          campaign: true,
          metric: true,
          value: true,
          staleAt: true,
          updatedAt: true,
        },
      })
    : [];
  return selectSeoEvidenceSources({ websiteUrl, facts, connections });
}

export async function getSeoWorkspace(input: {
  workspaceId: string;
  brandId: string;
  actorRole: WorkspaceRole;
}): Promise<SeoWorkspaceDto> {
  const brand = await findBrand(input.workspaceId, input.brandId);
  const [evidence, tasks] = await Promise.all([
    loadSeoEvidence(input.workspaceId, brand.websiteUrl),
    prisma.seoTask.findMany({
      where: {
        workspaceId: input.workspaceId,
        brandId: brand.id,
        verificationStatus: { not: "superseded" },
      },
      include: { proposals: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  return {
    brand: {
      id: brand.id,
      name: brand.name,
      websiteUrl: brand.websiteUrl ?? "",
      auditedAt: brand.auditedAt?.toISOString() ?? null,
    },
    sources: buildSeoSources(brand, evidence),
    tasks: sortTasks(tasks.map(toSeoTaskDto)),
    capability: { canManage: canManageSeo(input.actorRole) },
  };
}

export async function analyzeSeo(input: {
  workspaceId: string;
  brandId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  now?: Date;
}): Promise<SeoWorkspaceDto & { analysis: { created: number; refreshed: number } }> {
  requireSeoManager(input.actorRole);
  const brand = await findBrand(input.workspaceId, input.brandId);
  const evidence = await loadSeoEvidence(input.workspaceId, brand.websiteUrl);
  const derived = deriveSeoTasks(brand, evidence.facts);
  const now = input.now ?? new Date();
  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "workspaces" WHERE "id" = ${input.workspaceId} FOR UPDATE
    `;
    if (!locked.length) throw new SeoNotFoundError("brand");
    let created = 0;
    let refreshed = 0;
    const fingerprints = derived.map((candidate) => candidate.fingerprint);
    await tx.seoTask.updateMany({
      where: {
        workspaceId: input.workspaceId,
        brandId: brand.id,
        origin: { in: ["crawl", "search_console", "ga4"] },
        userEdited: false,
        status: { in: ["open", "in_progress"] },
        verificationStatus: { not: "superseded" },
        ...(fingerprints.length ? { fingerprint: { notIn: fingerprints } } : {}),
      },
      data: {
        status: "dismissed",
        verificationStatus: "superseded",
        analyzedAt: now,
        updatedBy: input.actorId,
        version: { increment: 1 },
      },
    });
    for (const candidate of derived) {
      const existing = await tx.seoTask.findUnique({
        where: {
          workspaceId_brandId_fingerprint: {
            workspaceId: input.workspaceId,
            brandId: brand.id,
            fingerprint: candidate.fingerprint,
          },
        },
        select: { id: true, userEdited: true, status: true, verificationStatus: true },
      });
      if (existing) {
        await tx.seoTask.update({
          where: { id: existing.id },
          data: {
            origin: candidate.source,
            evidence: candidate.evidence as unknown as Prisma.InputJsonValue,
            analyzedAt: now,
            updatedBy: input.actorId,
            version: { increment: 1 },
            ...(existing.status === "dismissed" && existing.verificationStatus === "superseded"
              ? { status: "open", verificationStatus: "unverified" }
              : {}),
            ...(existing.userEdited
              ? {}
              : {
                  category: candidate.category,
                  severity: candidate.severity,
                  priority: candidate.priority,
                  title: candidate.title,
                  description: candidate.description,
                  recommendedFix: candidate.recommendedFix,
                }),
          },
        });
        refreshed += 1;
      } else {
        await tx.seoTask.create({
          data: {
            workspaceId: input.workspaceId,
            brandId: brand.id,
            fingerprint: candidate.fingerprint,
            origin: candidate.source,
            category: candidate.category,
            severity: candidate.severity,
            priority: candidate.priority,
            title: candidate.title,
            description: candidate.description,
            recommendedFix: candidate.recommendedFix,
            status: "open",
            verificationStatus: "unverified",
            evidence: candidate.evidence as unknown as Prisma.InputJsonValue,
            analyzedAt: now,
            createdBy: input.actorId,
            updatedBy: input.actorId,
          },
        });
        created += 1;
      }
    }
    return { created, refreshed };
  });
  return {
    ...(await getSeoWorkspace(input)),
    analysis: result,
  };
}

export async function createSeoTask(input: CreateSeoTaskInput): Promise<SeoTaskDto> {
  requireSeoManager(input.actorRole);
  await findBrand(input.workspaceId, input.brandId);
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(input.requestId)) {
    throw new SeoValidationError("invalid_request_id", "requestId is invalid");
  }
  const semanticPayload = {
    title: input.title,
    description: input.description ?? null,
    recommendedFix: input.recommendedFix ?? null,
    category: input.category ?? "manual",
    severity: input.severity ?? "medium",
    priority: input.priority ?? 50,
  };
  const requestHash = createHash("sha256")
    .update(JSON.stringify(semanticPayload))
    .digest("hex");
  const fingerprint = `manual:${input.requestId}`;
  try {
    await prisma.seoTask.upsert({
      where: {
        workspaceId_brandId_fingerprint: {
          workspaceId: input.workspaceId,
          brandId: input.brandId,
          fingerprint,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        brandId: input.brandId,
        fingerprint,
        origin: "manual",
        ...semanticPayload,
        status: "open",
        verificationStatus: "unverified",
        evidence: { manualRequestHash: requestHash },
        userEdited: true,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      },
      update: {},
      select: { id: true },
    });
  } catch (error) {
    if (!isPrismaUniqueConflict(error)) throw error;
  }
  const row = await prisma.seoTask.findUniqueOrThrow({
    where: {
      workspaceId_brandId_fingerprint: {
        workspaceId: input.workspaceId,
        brandId: input.brandId,
        fingerprint,
      },
    },
    include: { proposals: true },
  });
  const storedEvidence = row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence)
    ? row.evidence as Record<string, unknown>
    : null;
  if (storedEvidence?.manualRequestHash !== requestHash) {
    throw new SeoConflictError(
      "idempotency_conflict",
      "requestId was already used for a different manual SEO task",
      row.version,
    );
  }
  return toSeoTaskDto(row);
}

async function currentTaskOrThrow(workspaceId: string, taskId: string): Promise<SeoTask> {
  const current = await prisma.seoTask.findFirst({
    where: { id: taskId, workspaceId },
  });
  if (!current) throw new SeoNotFoundError("task");
  return current;
}

export async function patchSeoTask(input: PatchSeoTaskInput): Promise<SeoTaskDto> {
  requireSeoManager(input.actorRole);
  const current = await currentTaskOrThrow(input.workspaceId, input.taskId);
  if (current.version !== input.expectedVersion) {
    throw new SeoConflictError(
      "version_conflict",
      "The SEO task changed since it was loaded",
      current.version,
    );
  }

  const editsGeneratedFields = [
    input.title,
    input.description,
    input.recommendedFix,
    input.category,
    input.severity,
    input.priority,
  ].some((value) => value !== undefined);
  const data: Prisma.SeoTaskUpdateManyMutationInput = {
    ...(editsGeneratedFields ? { userEdited: true } : {}),
    updatedBy: input.actorId,
    version: { increment: 1 },
  };
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.recommendedFix !== undefined) data.recommendedFix = input.recommendedFix;
  if (input.category !== undefined) data.category = input.category;
  if (input.severity !== undefined) data.severity = input.severity;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.status !== undefined) {
    data.status = input.status;
    data.verificationStatus = "unverified";
    if (input.status === "completed") {
      if (current.status !== "completed") {
        data.completedAt = new Date();
        data.completedBy = input.actorId;
      }
      if (input.completionNote !== undefined || current.status !== "completed") {
        data.completionNote = input.completionNote ?? null;
      }
    } else if (current.status === "completed") {
      data.completedAt = null;
      data.completedBy = null;
      data.completionNote = null;
    }
  }

  const updated = await prisma.seoTask.updateMany({
    where: {
      id: input.taskId,
      workspaceId: input.workspaceId,
      version: input.expectedVersion,
    },
    data,
  });
  if (!updated.count) {
    const latest = await currentTaskOrThrow(input.workspaceId, input.taskId);
    throw new SeoConflictError(
      "version_conflict",
      "The SEO task changed since it was loaded",
      latest.version,
    );
  }
  const row = await prisma.seoTask.findFirstOrThrow({
    where: { id: input.taskId, workspaceId: input.workspaceId },
    include: { proposals: true },
  });
  return toSeoTaskDto(row);
}

export async function getSeoTaskForMutation(input: {
  workspaceId: string;
  taskId: string;
  actorRole: WorkspaceRole;
}): Promise<SeoTask> {
  requireSeoManager(input.actorRole);
  return currentTaskOrThrow(input.workspaceId, input.taskId);
}
