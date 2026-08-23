export const SEO_SOURCE_IDS = ["crawl", "search_console", "ga4"] as const;
export type SeoSourceId = (typeof SEO_SOURCE_IDS)[number];
export type SeoTaskSource = SeoSourceId | "manual";
export type SeoSourceState = "available" | "unavailable" | "error";
export type SeoSeverity = "critical" | "high" | "medium" | "low";
export type SeoTaskStatus = "open" | "in_progress" | "completed" | "dismissed";

/** Sanitized public source coverage consumed by the SEO workspace UI. */
export interface SeoSourceDto {
  id: SeoSourceId;
  label: string;
  state: SeoSourceState;
  detail: string;
  observedFrom: string | null;
  observedTo: string | null;
  rowCount: number | null;
}

/** Sanitized public evidence. Rich metric context remains private at rest. */
export interface SeoEvidenceDto {
  source: string;
  label: string;
  value: string;
  observedFrom: string | null;
  observedTo: string | null;
}

/** Private persisted evidence used for exact derivation and AI grounding. */
export interface StoredSeoEvidence {
  source: SeoSourceId;
  label: string;
  metric: string;
  value: string | number;
  dateRange: { from: string; to: string };
  observedAt: string;
  dimension?: {
    type: "query" | "page" | "landing_page";
    value: string;
  };
  context?: {
    code?: string;
    category?: string;
    severity?: string;
    scoreImpact?: number;
    scope?: string;
  };
}

export interface SeoProposalDto {
  id: string;
  taskId: string;
  fields: { recommendedFix: string };
  provider: string;
  model: string;
  status: "proposed" | "accepted";
  createdAt: string;
}

export interface SeoTaskDto {
  id: string;
  source: SeoTaskSource;
  category: string;
  severity: SeoSeverity;
  priority: number;
  title: string;
  description: string;
  recommendedFix: string;
  status: SeoTaskStatus;
  verificationStatus: "unverified";
  evidence: SeoEvidenceDto[];
  completionNote: string | null;
  completedAt: string | null;
  version: number;
  updatedAt: string;
}

export interface SeoWorkspaceDto {
  brand: {
    id: string;
    name: string;
    websiteUrl: string;
    auditedAt: string | null;
  };
  sources: SeoSourceDto[];
  tasks: SeoTaskDto[];
  capability: { canManage: boolean };
}

export interface DerivedSeoTask {
  fingerprint: string;
  source: SeoSourceId;
  category: "technical" | "content" | "performance";
  severity: SeoSeverity;
  priority: number;
  title: string;
  description: string;
  recommendedFix: string;
  evidence: StoredSeoEvidence[];
}

export interface CreateSeoTaskInput {
  workspaceId: string;
  brandId: string;
  actorId: string;
  actorRole: "owner" | "admin" | "member";
  requestId: string;
  title: string;
  description?: string | null;
  recommendedFix?: string | null;
  category?: string;
  severity?: SeoSeverity;
  priority?: number;
}

export interface PatchSeoTaskInput {
  workspaceId: string;
  taskId: string;
  actorId: string;
  actorRole: "owner" | "admin" | "member";
  expectedVersion: number;
  title?: string;
  description?: string | null;
  recommendedFix?: string | null;
  category?: string;
  severity?: SeoSeverity;
  priority?: number;
  status?: SeoTaskStatus;
  completionNote?: string | null;
}
