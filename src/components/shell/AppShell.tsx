"use client";

import { useCallback, useState } from "react";
import type { Channel, Mode } from "@/types/views";
import type { Persona, Scenario } from "@/types/scenario";
import { PERSONAS } from "@/lib/data/personas";
import { SCENARIOS } from "@/lib/scenarios/registry";
import { resolveScenario, defaultScenarioFor } from "@/lib/scenarios/resolve";
import { useStreamingDemo } from "@/hooks/useStreamingDemo";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { SplitView } from "@/components/views/SplitView";
import { ThreadView } from "@/components/views/ThreadView";
import { ReportView } from "@/components/views/ReportView";
import { ConnectionsModal } from "@/components/modals/ConnectionsModal";

/**
 * Top-level orchestrator. Owns the active persona (which dataset is loaded),
 * view mode, the active question + resolved scenario, channel state, the modal,
 * and the recent-chat selection. The streaming surface ({ step, typed }, replay)
 * comes from useStreamingDemo, fed the active scenario's lead — in the real
 * product this is swapped for an SSE-backed hook without touching any view.
 */
export function AppShell() {
  const [persona, setPersona] = useState<Persona>("founder");
  const [mode, setMode] = useState<Mode>("split");
  const [scenario, setScenario] = useState<Scenario>(() => defaultScenarioFor("founder", SCENARIOS));
  const [question, setQuestion] = useState(scenario.question);
  const [channels, setChannels] = useState<Channel[]>(PERSONAS.founder.channels);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeChat, setActiveChat] = useState(0);

  const dataset = PERSONAS[persona];
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
      const q = PERSONAS[persona].recentChats[index].question;
      setQuestion(q);
      setScenario(resolveScenario(q, persona, SCENARIOS));
      replay();
    },
    [persona, replay],
  );

  // Switching persona swaps the whole dataset and restreams that persona's default.
  const switchPersona = useCallback(
    (p: Persona) => {
      setPersona(p);
      setActiveChat(0);
      setChannels(PERSONAS[p].channels);
      const sc = defaultScenarioFor(p, SCENARIOS);
      setScenario(sc);
      setQuestion(sc.question);
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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-page">
      <Sidebar
        activeChat={activeChat}
        onSelectChat={selectChat}
        recentChats={dataset.recentChats}
        channels={channels}
        account={dataset.account}
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
          persona={persona}
          onSwitchPersona={switchPersona}
        />

        {mode === "split" && (
          <SplitView
            step={step}
            typed={typed}
            question={question}
            scenario={scenario}
            onSend={ask}
            onSuggest={ask}
            suggestions={dataset.suggestions}
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
            suggestions={dataset.suggestions}
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
