import type { ConnectorPlatform, ConnectorCategory } from "@/lib/connectors/types";

export type Mode = "split" | "thread" | "report";

export type ChannelStatus = "connected" | "disconnected" | "error";

export interface Channel {
  name: string;
  status: ChannelStatus;
  platform?: ConnectorPlatform;
  /** Paid ads vs organic/SEO — drives the channel grouping in the sidebar. */
  category?: ConnectorCategory;
  externalAccountId?: string;
  displayName?: string | null;
}

/** A saved conversation in the sidebar's Recent list. */
export interface RecentChat {
  /** short conversation name shown in the sidebar and the top bar */
  title: string;
  /** the question that opened the conversation; re-asked on selection */
  question: string;
}
