"use client";

import { useCallback, useState } from "react";
import type { Channel, Mode } from "@/types/views";
import type { Persona, Scenario } from "@/types/scenario";
import { DEFAULT_CHANNELS, DEFAULT_QUESTION, RECENT_CHATS } from "@/lib/data/canonical";
import { SCENARIOS } from "@/lib/scenarios/registry";
import { resolveScenario } from "@/lib/scenarios/resolve";
import { useStreamingDemo } from "@/hooks/useStreamingDemo";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { SplitView } from "@/components/views/SplitView";
import { ThreadView } from "@/components/views/ThreadView";
import { ReportView } from "@/components/views/ReportView";
import { ConnectionsModal } from "@/components/modals/ConnectionsModal";

/**
 * Top-level orchestrator. Owns view mode, the active question + resolved
 * scenario, channel state, the modal, and the active recent-chat selection. The
 * streaming surface ({ step, typed }, replay) comes from useStreamingDemo, fed
 * the active scenario's lead — in the real product this is swapped for an
 * SSE-backed hook without touching any view.
 */
export function AppShell() {
  // Persona becomes user-switchable in Slice 2; founder is the default.
  const [persona] = useState<Persona>("founder");
  const [mode, setMode] = useState<Mode>("split");
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [scenario, setScenario] = useState<Scenario>(() =>
    resolveScenario(DEFAULT_QUESTION, "founder", SCENARIOS),
  );
  const [channels, setChannels] = useState<Channel[]>(DEFAULT_CHANNELS);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeChat, setActiveChat] = useState(0);

  const { state, replay } = useStreamingDemo(scenario.lead);
  const { step, typed } = state;

  // Ask a question → resolve to a canned scenario → restream it.
  const ask = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setQuestion(trimmed);
      setScenario(resolveScenario(trimmed, persona, SCENARIOS));
      replay();
    },
    [persona, replay],
  );

  // Selecting a recent chat re-asks its question and restreams.
  const selectChat = useCallback(
    (index: number) => {
      setActiveChat(index);
      const q = RECENT_CHATS[index].question;
      setQuestion(q);
      setScenario(resolveScenario(q, persona, SCENARIOS));
      replay();
    },
    [persona, replay],
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
          title={scenario.title}
          channels={channels}
        />

        {mode === "split" && (
          <SplitView
            step={step}
            typed={typed}
            question={question}
            scenario={scenario}
            onSend={ask}
            onSuggest={ask}
          />
        )}
        {mode === "thread" && (
          <ThreadView
            step={step}
            typed={typed}
            question={question}
            scenario={scenario}
            onSend={ask}
            onSuggest={ask}
          />
        )}
        {mode === "report" && (
          <ReportView step={step} typed={typed} question={question} scenario={scenario} />
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
