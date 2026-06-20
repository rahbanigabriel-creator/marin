"use client";

import { useCallback, useState } from "react";
import type { Channel, Mode } from "@/types/views";
import type { Persona, Scenario } from "@/types/scenario";
import { PERSONAS } from "@/lib/data/personas";
import { AGENCY_CLIENTS, type ClientAccount } from "@/lib/data/clients";
import { SCENARIOS } from "@/lib/scenarios/registry";
import { resolveScenario, defaultScenarioFor } from "@/lib/scenarios/resolve";
import { buildStarterPlan, type OnboardingIntake } from "@/lib/scenarios/buildStarterPlan";
import { buildClientScenario } from "@/lib/scenarios/buildClientScenario";
import { CEO_FORECAST, DEFAULT_FORECAST, type ForecastConfig } from "@/lib/forecast/project";
import { useStreamingDemo } from "@/hooks/useStreamingDemo";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { SplitView } from "@/components/views/SplitView";
import { ThreadView } from "@/components/views/ThreadView";
import { ReportView } from "@/components/views/ReportView";
import { ConnectionsModal } from "@/components/modals/ConnectionsModal";
import { OnboardingScreen } from "@/components/screens/OnboardingScreen";
import { ForecastScreen } from "@/components/screens/ForecastScreen";
import { ClientsScreen } from "@/components/screens/ClientsScreen";

type Screen = "chat" | "onboarding" | "forecast" | "clients";

/**
 * Top-level orchestrator. Owns the active persona + dataset, the top-level
 * screen, view mode, the active question + resolved scenario, the agency's
 * active client, channels, the modal, and recent-chat selection.
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
  const [activeClient, setActiveClient] = useState<string | null>(null);
  const [founderConfig, setFounderConfig] = useState<ForecastConfig>(DEFAULT_FORECAST);

  const dataset = PERSONAS[persona];
  const { state, replay } = useStreamingDemo(scenario.lead);
  const { step, typed } = state;

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

  // Switching persona swaps the dataset; the agency lands on its client roster.
  const switchPersona = useCallback(
    (p: Persona) => {
      setPersona(p);
      setActiveChat(0);
      setActiveClient(null);
      setChannels(PERSONAS[p].channels);
      const sc = defaultScenarioFor(p, SCENARIOS);
      setScenario(sc);
      setQuestion(sc.question);
      setScreen(p === "agency" ? "clients" : "chat");
      replay();
    },
    [replay],
  );

  // Opening a client scopes the workspace to it and streams its headline answer.
  const openClient = useCallback(
    (c: ClientAccount) => {
      setActiveClient(c.name);
      setQuestion(c.question);
      setScenario(buildClientScenario(c));
      setMode("split");
      setScreen("chat");
      replay();
    },
    [replay],
  );

  const completeOnboarding = useCallback(
    (intake: OnboardingIntake) => {
      const sc = buildStarterPlan(intake);
      const names = ["Google Ads", "Meta Ads", "GA4", "Search Console", "TikTok Ads", "LinkedIn Ads"];
      setPersona("founder");
      // A freshly-onboarded founder only has the channels they actually picked.
      setChannels(
        names.map((name): Channel => ({
          name,
          status: intake.channels.includes(name) ? "connected" : "disconnected",
        })),
      );
      setFounderConfig({ ...DEFAULT_FORECAST, current: intake.budget });
      setActiveChat(0);
      setActiveClient(null);
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
        showClients={persona === "agency"}
        onViewClients={() => setScreen("clients")}
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
            config={
              persona === "ceo" ? CEO_FORECAST : persona === "founder" ? founderConfig : DEFAULT_FORECAST
            }
          />
        ) : (
          <>
            <TopBar
              mode={mode}
              onSetMode={setMode}
              onReplay={replay}
              title={screen === "clients" ? "Clients" : scenario.title}
              channels={channels}
              persona={persona}
              onSwitchPersona={switchPersona}
              onForecast={() => setScreen("forecast")}
              chatControls={screen === "chat"}
              activeClient={screen === "chat" ? activeClient : null}
            />

            {screen === "clients" ? (
              <ClientsScreen
                clients={AGENCY_CLIENTS}
                workspace={dataset.workspace}
                onOpenClient={openClient}
              />
            ) : mode === "split" ? (
              <SplitView
                step={step}
                typed={typed}
                question={question}
                scenario={scenario}
                onSend={ask}
                onSuggest={ask}
                suggestions={dataset.suggestions}
              />
            ) : mode === "thread" ? (
              <ThreadView
                step={step}
                typed={typed}
                question={question}
                scenario={scenario}
                onSend={ask}
                onSuggest={ask}
                suggestions={dataset.suggestions}
              />
            ) : (
              <ReportView
                step={step}
                typed={typed}
                question={question}
                scenario={scenario}
                workspace={persona === "agency" && activeClient ? activeClient : dataset.workspace}
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
