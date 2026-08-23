import type { Prisma } from "@prisma/client";

export type ConversationMode = "assistant" | "organic" | "paid" | "seo";

export interface ConversationSummaryDto {
  id: string;
  brandId: string | null;
  title: string;
  mode: ConversationMode;
  status: string;
  lastMessageAt: string;
  updatedAt: string;
  preview: string | null;
}

export interface MessageDto {
  id: string;
  turnId: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Prisma.JsonValue | null;
  createdAt: string;
}

export interface ConversationDto extends ConversationSummaryDto {
  messages: MessageDto[];
}
