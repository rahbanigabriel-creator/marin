export const ORGANIC_PLATFORMS = [
  "youtube",
  "instagram",
  "facebook",
  "tiktok",
  "snapchat",
  "reddit",
  "pinterest",
] as const;

export type OrganicPlatform = (typeof ORGANIC_PLATFORMS)[number];
export type OrganicPlannerView = "week" | "month";
export type OrganicPlannerStatus =
  | "draft"
  | "ready"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export interface ContentItemDto {
  id: string;
  planId?: string | null;
  title: string;
  coreCopy: string | null;
  status: string;
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContentPlanDto {
  id: string;
  version: number;
  name: string;
  objective: string | null;
  status: "draft" | "active" | "archived";
  period: "week" | "month";
  startDate: string;
  endDate: string;
  timezone: string;
}

export interface CalendarPublicationDto {
  id: string;
  contentItemId: string;
  platform: OrganicPlatform;
  format: string;
  status: OrganicPlannerStatus;
  title: string | null;
  body: string;
  scheduledAt: string | null;
  createdAt?: string;
  updatedAt?: string;
  contentItem?: ContentItemDto | null;
}

export interface OrganicCalendarPost {
  publicationId: string;
  contentItemId: string;
  title: string;
  copy: string;
  platform: OrganicPlatform;
  format: string;
  status: OrganicPlannerStatus;
  scheduledAt: string;
  expectedVersion: number;
  planId: string | null;
}

export interface OrganicCalendarResponse {
  calendar?: {
    plans?: ContentPlanDto[];
    publications?: CalendarPublicationDto[];
    contentItems?: ContentItemDto[];
    items?: Array<ContentItemDto & { publications?: CalendarPublicationDto[] }>;
  };
  publications?: CalendarPublicationDto[];
  plans?: ContentPlanDto[];
  contentItems?: ContentItemDto[];
  items?: Array<ContentItemDto & { publications?: CalendarPublicationDto[] }>;
  data?: {
    plans?: ContentPlanDto[];
    publications?: CalendarPublicationDto[];
    contentItems?: ContentItemDto[];
    items?: Array<ContentItemDto & { publications?: CalendarPublicationDto[] }>;
  };
}

export interface OrganicPlannerProps {
  /** Durable audit context used for every manually created post. */
  brandId: string;
  /** IANA timezone used for calendar boundaries and wall-clock editing. */
  timezone?: string;
  locale?: string;
  initialView?: OrganicPlannerView;
  className?: string;
  onAskAI: (prompt: string) => void | Promise<void>;
  onPostSaved?: (post: OrganicCalendarPost) => void;
  /** Owners/admins can change plan lifecycle and delete plans. */
  canManagePlans?: boolean;
  /** Optional request implementation for integration tests or host-level auth wrappers. */
  fetcher?: typeof fetch;
}

export interface OrganicPostDraft {
  title: string;
  copy: string;
  platform: OrganicPlatform;
  format: string;
  date: string;
  time: string;
  status: OrganicPlannerStatus;
}
