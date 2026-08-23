import type {
  CapabilityLevel,
  ConnectionSection,
  ProductPlatformId,
} from "@/lib/product/platforms";
import type { ConnectorPlatform } from "@/lib/connectors/types";

export type Mode = "split" | "thread" | "report";

export type ChannelStatus = "connected" | "disconnected" | "error";

export type ProviderRevocationStatus = "confirmed" | "retained" | "failed" | "unavailable";

export interface ConnectionDisconnectResult {
  connectionId: string;
  disconnected: true;
  providerRevocation: ProviderRevocationStatus;
  message: string;
}

export interface Channel {
  name: string;
  status: ChannelStatus;
  /** Product-facing destination/source id. */
  platform?: ProductPlatformId;
  /** OAuth route id when this capability has a connector today. */
  connectorPlatform?: ConnectorPlatform;
  configured?: boolean;
  /** Drives the connection modal grouping. */
  category?: ConnectionSection;
  connectionAvailability?: CapabilityLevel;
  description?: string;
  /** Stable persisted account identity. Required for account-level mutations. */
  connectionId?: string;
  externalAccountId?: string;
  displayName?: string | null;
  currency?: string | null;
  timezone?: string | null;
  lastSyncAt?: string | null;
  lastSuccessfulSyncAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  updatedAt?: string;
}

/** One completed exchange in a multi-turn conversation (the agent's memory). */
export interface ChatTurn {
  question: string;
  /** the assistant's final answer text (+ a note of any canvas cards rendered) */
  answer: string;
}

/** A saved conversation in the sidebar's Recent list. */
export interface RecentChat {
  /** persisted conversation id; omitted for local/demo conversations */
  id?: string;
  /** short conversation name shown in the sidebar and the top bar */
  title: string;
  /** the question that opened the conversation; re-asked on selection */
  question: string;
  mode?: "assistant" | "organic" | "paid" | "seo";
}
