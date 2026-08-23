import { STEP_FOR_KIND, type ArtifactPayload, type DataMode } from "@/lib/streaming/events";
import type { ConversationDto, MessageDto } from "@/lib/conversations/types";
import type { ChatTurn } from "@/types/views";
import type { ResultChip } from "@/types/artifacts";

export interface RestoredConversation {
  turnId: string | null;
  turns: ChatTurn[];
  question: string;
  answer: string;
  artifacts: ArtifactPayload[];
  chips: ResultChip[];
  choices: { questions: { question: string; options: string[] }[] } | null;
  closing: { split: string; thread: string } | null;
  dataMode: DataMode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function metadataFor(message: MessageDto | undefined): RestoredConversation {
  const metadata = isRecord(message?.metadata) ? message.metadata : {};
  const artifacts = (Array.isArray(metadata.artifacts)
    ? metadata.artifacts.filter(
        (item) =>
          isRecord(item) &&
          typeof item.kind === "string" &&
          item.kind in STEP_FOR_KIND &&
          "data" in item,
      )
    : []) as unknown as ArtifactPayload[];
  const rawChoices = Array.isArray(metadata.choices) ? metadata.choices : [];
  const rawChips = Array.isArray(metadata.chips) ? metadata.chips : [];
  const chips = rawChips.filter(
    (item) =>
      isRecord(item) &&
      typeof item.label === "string" &&
      (item.tone === "good" || item.tone === "bad" || item.tone === "neutral" || item.tone === "clay"),
  ) as unknown as ResultChip[];
  const questions = rawChoices.filter(
    (item): item is { question: string; options: string[] } =>
      isRecord(item) &&
      typeof item.question === "string" &&
      Array.isArray(item.options) &&
      item.options.every((option) => typeof option === "string"),
  );
  const rawClosing = isRecord(metadata.closing) ? metadata.closing : null;
  const closing =
    rawClosing && typeof rawClosing.split === "string" && typeof rawClosing.thread === "string"
      ? { split: rawClosing.split, thread: rawClosing.thread }
      : null;
  const dataMode: DataMode =
    metadata.dataMode === "live" || metadata.dataMode === "sample" ? metadata.dataMode : "empty";

  return {
    turns: [],
    turnId: message?.turnId ?? null,
    question: "",
    answer: message?.content ?? "",
    artifacts,
    chips,
    choices: questions.length ? { questions } : null,
    closing,
    dataMode,
  };
}

export function restoreConversation(conversation: ConversationDto): RestoredConversation {
  const exchanges: Array<{ question: string; turnId: string | null; assistant?: MessageDto }> = [];
  let pendingQuestion: string | null = null;
  let pendingTurnId: string | null = null;

  for (const message of conversation.messages) {
    if (message.role === "user") {
      if (pendingQuestion) exchanges.push({ question: pendingQuestion, turnId: pendingTurnId });
      pendingQuestion = message.content;
      pendingTurnId = message.turnId;
    } else if (message.role === "assistant" && pendingQuestion) {
      exchanges.push({ question: pendingQuestion, turnId: pendingTurnId, assistant: message });
      pendingQuestion = null;
      pendingTurnId = null;
    }
  }
  if (pendingQuestion) exchanges.push({ question: pendingQuestion, turnId: pendingTurnId });

  const current = exchanges.at(-1);
  const currentMetadata = metadataFor(current?.assistant);
  return {
    ...currentMetadata,
    turns: exchanges.slice(0, -1).map((exchange) => ({
      question: exchange.question,
      answer: exchange.assistant?.content ?? "",
    })),
    question: current?.question ?? conversation.title,
    answer: current?.assistant?.content ?? "",
    turnId: current?.turnId ?? currentMetadata.turnId,
  };
}
