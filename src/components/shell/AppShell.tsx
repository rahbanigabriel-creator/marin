"use client";

import { useCallback, useState } from "react";
import type { Channel, Mode } from "@/types/views";
import type { Persona, Scenario } from "@/types/scenario";
import { PERSONAS } from "@/lib/data/personas";
import { SCENARIOS } from "@/lib/scenarios/registry";
import { resolveScenario, defaultScenarioFor } from "@/lib/scenarios/resolve";
import { buildStarterPlan, type OnboardingIntake } from "@/lib/scenarios/buildStarterPlan";
import { CEO_FORECAST, DEFAULT_FORECAST } from "@/lib/forecast/project";
import { useStreamingDemo } from "@/hooks/useStreamingDemo";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { SplitView } from "@/components/views/SplitView";
import { ThreadView } from "@/components/views/ThreadView";
import { ReportView } from "@/components/views/ReportView";
import { ConnectionsModal } from "@/components/modals/ConnectionsModal";
import { OnboardingScreen } from "@/components/screens/OnboardingScreen";
import { ForecastScreen } from "@/components/screens/ForecastScreen";

type Screen = "chat" | "onboarding" | "forecast";

/**
 * Top-level orchestrator. Owns the active persona (which dataset is loaded), the
 * top-level screen, view mode, the active question + resolved scenario, channel
 * state, the modal, and the recent-chat selection. The streaming surface
 * ({ step, typed }, replay) comes from useStreamingDemo, fed the active
 * scenario's lead — swapped for an SSE-backed hook later without touching views.
 */
export function AppShell() {
  const [persona, setPersona] = useState<Persona>("founder");
  const [screen, setScreen] = useState<Screen>("chat");
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
      setScreen("chat");
      setActiveChat(0);
      setChannels(PERSONAS[p].channels);
      const sc = defaultScenarioFor(p, SCENARIOS);
      setScenario(sc);
      setQuestion(sc.question);
      replay();
    },
    [replay],
  );

  // Onboarding completes → build a plan from the intake and stream it.
  const completeOnboarding = useCallback(
    (intake: OnboardingIntake) => {
      const sc = buildStarterPlan(intake);
      setPersona("founder");
      setChannels(PERSONAS.founder.channels);
      setActiveChat(0);
      setQuestion(sc.question);
      setScenario(sc);
      setScreen("chat");
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
        onStartPlan={() => setScreen("onboarding")}
        onOpenModal={() => setModalOpen(true)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {screen === "onboarding" ? (
          <OnboardingScreen onComplete={completeOnboarding} onCancel={() => setScreen("chat")} />
        ) : screen === "forecast" ? (
          <ForecastScreen
            onClose={() => setScreen("chat")}
            config={persona === "ceo" ? CEO_FORECAST : DEFAULT_FORECAST}
          />
        ) : (
          <>
            <TopBar
              mode={mode}
              onSetMode={setMode}
              onReplay={replay}
              title={scenario.title}
              channels={channels}
              persona={persona}
              onSwitchPersona={switchPersona}
              onForecast={() => setScreen("forecast")}
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
              <ReportView
                step={step}
                typed={typed}
                question={question}
                scenario={scenario}
                workspace={dataset.workspace}
              />
            )}
          </>
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
