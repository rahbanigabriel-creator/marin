import type { Prisma } from "@prisma/client";

import {
  redactInfluencerContact,
} from "@/lib/influencers/capabilities";
import type {
  InfluencerCapability,
  InfluencerCrmStatus,
  InfluencerMetricName,
  InfluencerPlatform,
  InfluencerSource,
} from "@/lib/influencers/types";
import { influencerTrackingExpiresAt } from "@/lib/influencers/tracking";

export const influencerProfileInclude = {
  metrics: {
    orderBy: [{ metric: "asc" as const }, { id: "asc" as const }],
  },
  outreachDrafts: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: 50,
  },
  trackingLinks: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: 50,
  },
} satisfies Prisma.InfluencerProfileInclude;

export type InfluencerProfileRecord = Prisma.InfluencerProfileGetPayload<{
  include: typeof influencerProfileInclude;
}>;

export interface InfluencerMetricDto {
  metric: InfluencerMetricName;
  value: number;
  sourceUrl: string | null;
  observedAt: string;
  source: "manual" | "public_profile" | "vendor";
}

export interface InfluencerOutreachDto {
  id: string;
  subject: string | null;
  body: string;
  sponsorshipDisclosure: string;
  claimsRestrictions: string | null;
  compensationNote: string | null;
  status: "draft";
  createdAt: string;
  updatedAt: string;
}

export interface InfluencerTrackingLinkDto {
  id: string;
  slug: string;
  destinationUrl: string;
  taggedDestinationUrl: string;
  trackingUrl: string;
  campaignKey: string;
  enabled: boolean;
  clickCount: string;
  lastClickedAt: string | null;
  disabledAt: string | null;
  expiresAt: string;
  version: number;
  createdAt: string;
}

export interface InfluencerProfileDto {
  id: string;
  version: number;
  platform: InfluencerPlatform;
  handle: string;
  normalizedHandle: string;
  profileUrl: string;
  displayName: string | null;
  contactEmail: string | null;
  contactName: string | null;
  topics: string[];
  audienceCountries: string[];
  notes: string | null;
  status: InfluencerCrmStatus;
  source: InfluencerSource;
  metrics: InfluencerMetricDto[];
  qualificationEvidence: [];
  outreachDrafts: InfluencerOutreachDto[];
  trackingLinks: InfluencerTrackingLinkDto[];
  campaigns: [];
  deliverables: [];
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InfluencerCoverageDto {
  profileCount: number;
  observedAt: string | null;
  lastActivityAt: string | null;
  detail: string;
}

export interface InfluencerWorkspaceDto {
  profiles: InfluencerProfileDto[];
  capability: Omit<InfluencerCapability, "canRead">;
  coverage: InfluencerCoverageDto;
}

function stringList(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function platform(value: string): InfluencerPlatform {
  return value as InfluencerPlatform;
}

function status(value: string): InfluencerCrmStatus {
  return value as InfluencerCrmStatus;
}

function source(value: string): InfluencerSource {
  return value as InfluencerSource;
}

export function toInfluencerTrackingLinkDto(
  row: InfluencerProfileRecord["trackingLinks"][number],
  appUrl: string,
): InfluencerTrackingLinkDto {
  return {
    id: row.id,
    slug: row.slug,
    destinationUrl: row.destinationUrl,
    taggedDestinationUrl: row.taggedDestinationUrl,
    trackingUrl: new URL(`/go/${encodeURIComponent(row.slug)}`, appUrl).toString(),
    campaignKey: row.campaignKey,
    enabled: row.enabled,
    clickCount: row.clickCount.toString(),
    lastClickedAt: row.lastClickedAt?.toISOString() ?? null,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    expiresAt: influencerTrackingExpiresAt(row.createdAt).toISOString(),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toInfluencerOutreachDto(
  row: InfluencerProfileRecord["outreachDrafts"][number],
): InfluencerOutreachDto {
  return {
    id: row.id,
    subject: row.subject,
    body: row.body,
    sponsorshipDisclosure: row.sponsorshipDisclosure,
    claimsRestrictions: row.claimsRestrictions,
    compensationNote: row.compensationNote,
    status: "draft",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toInfluencerProfileDto(
  row: InfluencerProfileRecord,
  capability: InfluencerCapability,
  appUrl: string,
): InfluencerProfileDto {
  const dto: InfluencerProfileDto = {
    id: row.id,
    version: row.version,
    platform: platform(row.platform),
    handle: row.handle,
    normalizedHandle: row.normalizedHandle,
    profileUrl: row.profileUrl,
    displayName: row.displayName,
    contactEmail: row.contactEmail,
    contactName: row.contactName,
    topics: stringList(row.topics),
    audienceCountries: stringList(row.audienceCountries),
    notes: row.notes,
    status: status(row.status),
    source: source(row.source),
    metrics: row.metrics.map((metric) => ({
      metric: metric.metric as InfluencerMetricName,
      value: metric.value,
      sourceUrl: metric.sourceUrl,
      observedAt: metric.observedAt.toISOString(),
      source: metric.source as InfluencerMetricDto["source"],
    })),
    qualificationEvidence: [],
    outreachDrafts: row.outreachDrafts.map(toInfluencerOutreachDto),
    trackingLinks: row.trackingLinks.map((link) =>
      toInfluencerTrackingLinkDto(link, appUrl)),
    campaigns: [],
    deliverables: [],
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  return redactInfluencerContact(dto, capability);
}
