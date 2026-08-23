import type { Message, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type {
  ConversationDto,
  ConversationMode,
  ConversationSummaryDto,
  MessageDto,
} from "@/lib/conversations/types";

const MODES = new Set<ConversationMode>(["assistant", "organic", "paid", "seo"]);

export function normalizeConversationMode(value: unknown): ConversationMode {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MODES.has(normalized as ConversationMode)
    ? (normalized as ConversationMode)
    : "assistant";
}

export function conversationTitle(question: string): string {
  const clean = question.replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  return clean.length > 72 ? `${clean.slice(0, 71)}…` : clean;
}

function toMessageDto(message: Message): MessageDto {
  return {
    id: message.id,
    turnId: message.turnId,
    role: message.role as MessageDto["role"],
    content: message.content,
    metadata: message.metadata,
    createdAt: message.createdAt.toISOString(),
  };
}

export async function listConversations(workspaceId: string): Promise<ConversationSummaryDto[]> {
  const rows = await prisma.conversation.findMany({
    where: { workspaceId, status: "active" },
    orderBy: { lastMessageAt: "desc" },
    take: 50,
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return rows.map((row) => ({
    id: row.id,
    brandId: row.brandId,
    title: row.title,
    mode: normalizeConversationMode(row.mode),
    status: row.status,
    lastMessageAt: row.lastMessageAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    preview: row.messages[0]?.content.slice(0, 180) ?? null,
  }));
}

export async function createConversation(input: {
  workspaceId: string;
  brandId?: string | null;
  title?: string;
  question?: string;
  mode?: unknown;
  createdBy?: string | null;
}, db: Pick<Prisma.TransactionClient, "brand" | "conversation"> = prisma): Promise<ConversationDto> {
  const brandId = input.brandId === undefined
    ? (await db.brand.findFirst({
        where: { workspaceId: input.workspaceId, isPrimary: true },
        select: { id: true },
      }))?.id ?? null
    : input.brandId;
  if (brandId) {
    const ownsBrand = await db.brand.count({ where: { id: brandId, workspaceId: input.workspaceId } });
    if (!ownsBrand) throw new Error("Brand not found");
  }
  const now = new Date();
  const row = await db.conversation.create({
    data: {
      workspaceId: input.workspaceId,
      brandId,
      title: conversationTitle(input.title ?? input.question ?? ""),
      mode: normalizeConversationMode(input.mode),
      createdBy: input.createdBy ?? null,
      lastMessageAt: now,
    },
    include: { messages: true },
  });
  return {
    id: row.id,
    brandId: row.brandId,
    title: row.title,
    mode: normalizeConversationMode(row.mode),
    status: row.status,
    lastMessageAt: row.lastMessageAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    preview: null,
    messages: [],
  };
}

export async function getConversation(
  workspaceId: string,
  conversationId: string,
): Promise<ConversationDto | null> {
  const row = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!row) return null;
  return {
    id: row.id,
    brandId: row.brandId,
    title: row.title,
    mode: normalizeConversationMode(row.mode),
    status: row.status,
    lastMessageAt: row.lastMessageAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    preview: row.messages.at(-1)?.content.slice(0, 180) ?? null,
    messages: row.messages.map(toMessageDto),
  };
}

export async function archiveConversation(workspaceId: string, conversationId: string): Promise<boolean> {
  const result = await prisma.conversation.updateMany({
    where: { id: conversationId, workspaceId },
    data: { status: "archived" },
  });
  return result.count > 0;
}

export async function persistMessage(input: {
  workspaceId: string;
  conversationId: string;
  role: MessageDto["role"];
  turnId?: string | null;
  content: string;
  metadata?: unknown;
}): Promise<MessageDto> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, workspaceId: input.workspaceId, status: "active" },
    select: { id: true },
  });
  if (!conversation) throw new Error("Conversation not found");
  const content = input.content.trim().slice(0, 100_000);
  if (!content) throw new Error("Message content is required");
  const metadata =
    input.metadata === undefined
      ? undefined
      : (JSON.parse(JSON.stringify(input.metadata)) as Prisma.InputJsonValue);
  const now = new Date();
  const turnId = input.turnId?.trim().slice(0, 120) || null;
  const messageWrite = turnId
    ? prisma.message.upsert({
        where: {
          conversationId_role_turnId: {
            conversationId: input.conversationId,
            role: input.role,
            turnId,
          },
        },
        update: { content, metadata },
        create: {
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          turnId,
          role: input.role,
          content,
          metadata,
        },
      })
    : prisma.message.create({
        data: {
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          role: input.role,
          content,
          metadata,
        },
      });
  const [message] = await prisma.$transaction([
    messageWrite,
    prisma.conversation.update({
      where: { id: input.conversationId },
      data: { lastMessageAt: now },
    }),
  ]);
  return toMessageDto(message);
}
