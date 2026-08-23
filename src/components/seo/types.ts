export type SeoSourceId = "crawl" | "search_console" | "ga4";
export type SeoTaskSource = SeoSourceId | "manual";
export type SeoSourceState = "available" | "unavailable" | "error";
export type SeoSeverity = "critical" | "high" | "medium" | "low";
export type SeoTaskStatus = "open" | "in_progress" | "completed" | "dismissed";

export interface SeoBrandSummary {
  id: string;
  name: string;
  websiteUrl: string;
  auditedAt: string | null;
}

export interface SeoSourceCoverage {
  id: SeoSourceId;
  label: string;
  state: SeoSourceState;
  detail: string;
  observedFrom: string | null;
  observedTo: string | null;
  rowCount: number | null;
}

export interface SeoEvidence {
  source: string;
  label: string;
  value: string;
  observedFrom: string | null;
  observedTo: string | null;
}

export interface SeoTask {
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
  evidence: SeoEvidence[];
  completionNote: string | null;
  completedAt: string | null;
  version: number;
  updatedAt: string;
}

export interface SeoWorkspaceResponse {
  brand: SeoBrandSummary;
  sources: SeoSourceCoverage[];
  tasks: SeoTask[];
  capability: { canManage: boolean };
}

export interface SeoProposal {
  id: string;
  taskId: string;
  fields: { recommendedFix: string };
  provider: string;
  model: string;
  status: string;
  createdAt: string;
}
