"use client";

import { useCallback, useState } from "react";
import type { Channel, Mode } from "@/types/views";
import {
  CANONICAL_ANSWER,
  DEFAULT_CHANNELS,
  DEFAULT_QUESTION,
  RECENT_CHATS,
} from "@/lib/data/canonical";
import { useStreamingDemo } from "@/hooks/useStreamingDemo";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { SplitView } from "@/components/views/SplitView";
import { ThreadView } from "@/components/views/ThreadView";
import { ReportView } from "@/components/views/ReportView";
import { ConnectionsModal } from "@/components/modals/ConnectionsModal";

/**
 * Top-level orchestrator. Owns view mode, the active question, channel
 * connection state, the modal, and the active recent-chat selection. The
 * streaming surface ({ step, typed }, replay) comes from useStreamingDemo —
 * in the real product this is swapped for an SSE-backed hook without touching
 * any view.
 */
export function AppShell() {
  const { state, replay } = useStreamingDemo();
  const { step, typed } = state;

  const [mode, setMode] = useState<Mode>("split");
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [channels, setChannels] = useState<Channel[]>(DEFAULT_CHANNELS);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeChat, setActiveChat] = useState(0);

  const answer = CANONICAL_ANSWER;

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed) setQuestion(trimmed);
      replay();
    },
    [replay],
  );

  const toggleChannel = useCallback((index: number) => {
    setChannels((prev) =>
      prev.map((ch, i) =>
        i === index
          ? { ...ch, status: ch.status === "connected" ? "disconnected" : "connected" }
          : ch,
      ),
    );
  }, []);

  // Selecting a recent chat re-asks its question, restreams the answer, and
  // (via activeChat) retitles the top bar.
  const selectChat = useCallback(
    (index: number) => {
      setActiveChat(index);
      setQuestion(RECENT_CHATS[index].question);
      replay();
    },
    [replay],
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-page">
      <Sidebar
        activeChat={activeChat}
        onSelectChat={selectChat}
        channels={channels}
        onNewChat={replay}
        onOpenModal={() => setModalOpen(true)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar
          mode={mode}
          onSetMode={setMode}
          onReplay={replay}
          title={RECENT_CHATS[activeChat].title}
          channels={channels}
        />

        {mode === "split" && (
          <SplitView
            step={step}
            typed={typed}
            question={question}
            answer={answer}
            onSend={send}
            onSuggest={send}
          />
        )}
        {mode === "thread" && (
          <ThreadView
            step={step}
            typed={typed}
            question={question}
            answer={answer}
            onSend={send}
            onSuggest={send}
          />
        )}
        {mode === "report" && (
          <ReportView step={step} typed={typed} question={question} answer={answer} />
        )}
      </main>

      {modalOpen && (
        <ConnectionsModal
          channels={channels}
          onClose={() => setModalOpen(false)}
          onToggle={toggleChannel}
        />
      )}
    </div>
  );
}
