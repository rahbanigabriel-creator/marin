import type { Prisma } from "@prisma/client";

import type { WorkspaceRole } from "@/lib/auth";

export type ContentPlanPeriod = "week" | "month";
export type ContentPlanStatus = "draft" | "active" | "archived";
export type ContentItemStatus = "idea" | "draft" | "review" | "approved" | "archived";

export interface ContentPlanDto {
  id: string;
  brandId: string | null;
  name: string;
  objective: string | null;
  status: ContentPlanStatus;
  version: number;
  period: ContentPlanPeriod;
  startDate: string;
  endDate: string;
  timezone: string;
  strategy: Prisma.JsonValue | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentItemDto {
  id: string;
  brandId: string | null;
  planId: string | null;
  status: ContentItemStatus;
  source: string;
  title: string;
  brief: string | null;
  coreCopy: string | null;
  objective: string | null;
  metadata: Prisma.JsonValue | null;
  version: number;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentPublicationDto {
  id: string;
  contentItemId: string;
  channelAccountId: string | null;
  platform: string;
  format: string;
  status: string;
  title: string | null;
  body: string;
  firstComment: string | null;
  linkUrl: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  permalink?: string | null;
  publishAttempts?: number;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AssistedHandoffOutcome = "completed" | "failed";
export type AssistedHandoffCompletionEvidence = "not_recorded" | "user_confirmed_external_handoff" | "unverified_external_completion";

export type AssistedHandoffCapabilityReasonCode =
  | "role_required"
  | "unsupported_destination"
  | "content_version_not_approved"
  | "publication_not_ready"
  | "publication_history_only";

export interface AssistedHandoffAttemptDto {
  id: string;
  outcome: AssistedHandoffOutcome;
  contentVersion: number;
  permalink: string | null;
  error: string | null;
  attemptedAt: string;
}

export interface AssistedHandoffDto {
  publication: {
    id: string;
    contentItemId: string;
    platform: string;
    format: string;
    status: string;
    contentVersion: number;
    publishedAt: string | null;
    permalink: string | null;
    externalCompletionEvidence: AssistedHandoffCompletionEvidence;
    publishAttempts: number;
    lastError: string | null;
  };
  copy: {
    title: string | null;
    body: string;
    firstComment: string | null;
    linkUrl: string | null;
  };
  assets: Array<{
    id: string;
    position: number;
    role: "media" | "thumbnail" | "cover";
    altText: string | null;
    filename: string;
    mimeType: string;
    bytes: number;
    downloadUrl: string;
  }>;
  capability: {
    level: "assisted";
    openPlatformUrl: string | null;
    canPrepare: boolean;
    canRecord: boolean;
    reasonCode: AssistedHandoffCapabilityReasonCode | null;
    reason: string | null;
  };
  attempts: AssistedHandoffAttemptDto[];
}

export interface RecordAssistedHandoffInput {
  workspaceId: string;
  publicationId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  requestId: string;
  expectedContentVersion: number;
  outcome: AssistedHandoffOutcome;
  permalink?: string | null;
  failureReason?: string | null;
  now?: Date;
}

export interface RecordAssistedHandoffResult {
  handoff: AssistedHandoffDto;
  reused: boolean;
}

export interface ContentAssetDto {
  id: string;
  kind: "image" | "video";
  mimeType: string;
  bytes: number;
  filename: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  source: string;
  contentUrl: string;
  createdAt: string;
}

export interface ContentItemAssetDto {
  id: string;
  position: number;
  role: "media" | "thumbnail" | "cover";
  altText: string | null;
  asset: ContentAssetDto;
}

export interface ContentStudioItemDto {
  contentItem: ContentItemDto;
  publications: ContentPublicationDto[];
  assets: ContentItemAssetDto[];
}

export type ContentProposalKind = "master" | "variant";

export interface MasterContentProposalFields {
  title: string;
  objective: string;
  brief: string;
  coreCopy: string;
}

export interface VariantContentProposalFields {
  title: string;
  body: string;
  firstComment: string;
}

interface ContentProposalBaseDto {
  id: string;
  contentItemId: string;
  publicationId: string | null;
  requestId: string;
  platform: string | null;
  format: string | null;
  provider: string;
  model: string;
  status: "proposed" | "accepted" | "dismissed";
  createdAt: string;
}

export type ContentProposalDto = ContentProposalBaseDto & (
  | { kind: "master"; fields: MasterContentProposalFields }
  | { kind: "variant"; fields: VariantContentProposalFields }
);

export interface ContentCalendarDto {
  start: string;
  end: string;
  timezone: string;
  plans: ContentPlanDto[];
  contentItems: ContentItemDto[];
  publications: ContentPublicationDto[];
}

export type CalendarPostStatus = "draft" | "ready";

export interface ContentPostDto {
  contentItem: ContentItemDto;
  publication: ContentPublicationDto;
}

export interface CreateContentPostInput {
  workspaceId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  brandId: string;
  planId?: string | null;
  title: string;
  coreCopy: string;
  platform: string;
  format: string;
  status: CalendarPostStatus;
  scheduledAt: Date;
  /** Existing item whose attached media should be copied onto this new post. */
  sourceContentItemId?: string | null;
  now?: Date;
}

export interface PatchContentPostInput {
  workspaceId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  publicationId: string;
  expectedVersion: number;
  title?: string;
  coreCopy?: string;
  status?: CalendarPostStatus;
  scheduledAt?: Date;
  now?: Date;
}

export interface CreateContentPlanInput {
  workspaceId: string;
  createdBy: string;
  brandId: string;
  name: string;
  objective?: string | null;
  period: ContentPlanPeriod;
  startDate: Date;
  endDate: Date;
  timezone: string;
}

export interface PatchContentPlanInput {
  workspaceId: string;
  planId: string;
  actorRole: WorkspaceRole;
  expectedVersion: number;
  name?: string;
  objective?: string | null;
  status?: ContentPlanStatus;
}

export interface DeleteContentPlanInput {
  workspaceId: string;
  planId: string;
  actorRole: WorkspaceRole;
  expectedVersion: number;
}

export interface DeleteContentPlanResult {
  planId: string;
  deleted: true;
  contentItems: ContentItemDto[];
}

export interface DeleteContentPostInput {
  workspaceId: string;
  publicationId: string;
  actorRole: WorkspaceRole;
  expectedVersion: number;
}

export interface DeleteContentPostResult {
  publicationId: string;
  contentItemId: string;
  contentItemVersion: number;
  contentItem: ContentItemDto;
}

export interface WeeklyPlanIdea {
  date: string;
  time: string;
  platform: string;
  format: string;
  title: string;
  copy: string;
}

export interface GenerateWeeklyPlanInput {
  workspaceId: string;
  actorId: string;
  brandId: string;
  platforms: string[];
  requestId: string;
  period?: ContentPlanPeriod;
  now?: Date;
}

export interface GenerateWeeklyPlanResult {
  plan: ContentPlanDto;
  posts: ContentPostDto[];
  reused: boolean;
  fallback: boolean;
  model: string | null;
}

export interface CreateContentItemInput {
  workspaceId: string;
  createdBy: string;
  actorRole: WorkspaceRole;
  brandId?: string | null;
  planId?: string | null;
  status: ContentItemStatus;
  title: string;
  brief?: string | null;
  coreCopy?: string | null;
  objective?: string | null;
  metadata?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
}

export interface PatchContentItemInput {
  workspaceId: string;
  contentItemId: string;
  actorId: string;
  actorRole: WorkspaceRole;
  expectedVersion: number;
  brandId?: string | null;
  planId?: string | null;
  status?: ContentItemStatus;
  title?: string;
  brief?: string | null;
  coreCopy?: string | null;
  objective?: string | null;
  metadata?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  proposalId?: string;
  approvalIntent?: true;
}

export interface CreateContentVariantInput {
  workspaceId: string;
  contentItemId: string;
  actorId?: string;
  actorRole: WorkspaceRole;
  expectedVersion: number;
  platform: string;
  format: string;
  title?: string | null;
  body: string;
  firstComment?: string | null;
  linkUrl?: string | null;
  status: CalendarPostStatus;
  scheduledAt?: Date | null;
  proposalId?: string;
  now?: Date;
}

export interface PatchContentVariantInput {
  workspaceId: string;
  publicationId: string;
  actorId?: string;
  actorRole: WorkspaceRole;
  expectedVersion: number;
  platform?: string;
  format?: string;
  title?: string | null;
  body?: string;
  firstComment?: string | null;
  linkUrl?: string | null;
  status?: CalendarPostStatus;
  scheduledAt?: Date | null;
  proposalId?: string;
  now?: Date;
}

export interface DeleteContentVariantInput {
  workspaceId: string;
  publicationId: string;
  actorRole: WorkspaceRole;
  expectedVersion: number;
}
