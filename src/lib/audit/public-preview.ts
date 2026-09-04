import {
  isAppleAppStoreListingUrl,
  type AuditDocumentType,
} from "@/lib/audit/document";
import type { SiteAuditResult } from "@/lib/audit/site";

export const PUBLIC_AUDIT_FINDING_LIMIT = 5;

export interface PublicAuditPreview {
  documentType: AuditDocumentType;
  sourceUrl: string;
  finalUrl: string;
  title: string | null;
  score: number;
  summary: {
    wordCount: number;
    h1Count: number;
    links: number;
    imagesWithoutAlt: number;
    indexAllowed: boolean;
  };
  findings: Array<{
    code: string;
    severity: SiteAuditResult["findings"][number]["severity"];
    title: string;
    evidence: string;
    recommendation: string;
  }>;
}

export function buildAuditSignupHref(website: string): string {
  const destination = `/app?q=${encodeURIComponent(website)}`;
  return `/sign-up?redirect_url=${encodeURIComponent(destination)}`;
}

/**
 * Keep the unauthenticated response useful but deliberately bounded. The full
 * crawl snapshot stays server-side in a short-lived one-time signup handoff.
 */
export function toPublicAuditPreview(audit: SiteAuditResult): PublicAuditPreview {
  return {
    documentType: audit.documentType ?? (
      isAppleAppStoreListingUrl(audit.finalUrl) ? "apple_app_store" : "website"
    ),
    sourceUrl: audit.sourceUrl,
    finalUrl: audit.finalUrl,
    title: audit.title,
    score: audit.score,
    summary: {
      wordCount: audit.wordCount,
      h1Count: audit.headings.h1Count,
      links: audit.links.total,
      imagesWithoutAlt: audit.images.withoutAlt,
      indexAllowed: audit.robots.indexAllowed,
    },
    findings: audit.findings.slice(0, PUBLIC_AUDIT_FINDING_LIMIT).map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      title: finding.title,
      evidence: finding.evidence,
      recommendation: finding.recommendation,
    })),
  };
}
