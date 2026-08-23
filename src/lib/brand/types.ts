import type { Prisma } from "@prisma/client";

export interface BrandDto {
  id: string;
  name: string;
  websiteUrl: string | null;
  isPrimary: boolean;
  summary: string | null;
  audience: string[];
  voice: string[];
  offers: string[];
  competitors: string[];
  proofPoints: string[];
  visualStyle: string[];
  locale: string;
  timezone: string;
  currency: string;
  contextVersion: number;
  auditSnapshot: Prisma.JsonValue | null;
  auditedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrandWriteInput {
  name?: string;
  websiteUrl?: string | null;
  summary?: string | null;
  audience?: string[];
  voice?: string[];
  offers?: string[];
  competitors?: string[];
  proofPoints?: string[];
  visualStyle?: string[];
  locale?: string;
  timezone?: string;
  currency?: string;
  auditSnapshot?: Prisma.InputJsonValue | null;
  auditedAt?: Date | null;
}

export interface BrandPromptContext {
  id: string;
  name: string;
  websiteUrl: string | null;
  summary: string | null;
  audience: string[];
  voice: string[];
  offers: string[];
  competitors: string[];
  proofPoints: string[];
  locale: string;
  timezone: string;
  currency: string;
  contextVersion: number;
}
