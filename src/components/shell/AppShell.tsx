"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Channel, Mode } from "@/types/views";
import type { Persona, Scenario } from "@/types/scenario";
import { PERSONAS } from "@/lib/data/personas";
import { AGENCY_CLIENTS, type ClientAccount } from "@/lib/data/clients";
import { SCENARIOS } from "@/lib/scenarios/registry";
import { resolveScenario, defaultScenarioFor } from "@/lib/scenarios/resolve";
import { buildStarterPlan, type OnboardingIntake } from "@/lib/scenarios/buildStarterPlan";
import { buildClientScenario } from "@/lib/scenarios/buildClientScenario";
import { CEO_FORECAST, DEFAULT_FORECAST, type ForecastConfig } from "@/lib/forecast/project";
import { useStreamingChat } from "@/hooks/useStreamingChat";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { SplitView } from "@/components/views/SplitView";
import { ThreadView } from "@/components/views/ThreadView";
import { ReportView } from "@/components/views/ReportView";
import { ConnectionsModal } from "@/components/modals/ConnectionsModal";
import { OnboardingScreen } from "@/components/screens/OnboardingScreen";
import { ForecastScreen } from "@/components/screens/ForecastScreen";
import { ClientsScreen } from "@/components/screens/ClientsScreen";
import { FirstRunScreen } from "@/components/screens/FirstRunScreen";

type Screen = "chat" | "onboarding" | "forecast" | "clients";

const REAL_CONNECTOR_CHANNELS: Channel[] = [
  { name: "Google Ads", platform: "google_ads", status: "disconnected" },
  { name: "Google Analytics 4", platform: "ga4", status: "disconnected" },
  { name: "Meta Ads", platform: "meta_ads", status: "disconnected" },
  { name: "Apple Search Ads", platform: "apple_search_ads", status: "disconnected" },
];

const DEMO_MODE = process.env.NEXT_PUBLIC_MARPIN_DEMO_MODE === "true";

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
  const [channels, setChannels] = useState<Channel[]>(REAL_CONNECTOR_CHANNELS);
  const [workspaceName, setWorkspaceName] = useState("Personal workspace");
  const [modalOpen, setModalOpen] = useState(false);
  const [activeChat, setActiveChat] = useState(0);
  const [activeClient, setActiveClient] = useState<string | null>(null);
  const [founderConfig, setFounderConfig] = useState<ForecastConfig>(DEFAULT_FORECAST);

  const dataset = PERSONAS[persona];
  const realProductMode = !DEMO_MODE;
  const realChannels = channels;
  const connectedCount = realChannels.filter((channel) => channel.status === "connected").length;
  const showFirstRun = realProductMode && connectedCount === 0 && screen === "chat";
  const sidebarAccount = realProductMode
    ? { name: workspaceName, sub: "Marpin workspace", initials: workspaceName.slice(0, 2).toUpperCase() }
    : dataset.account;
  // The staged-reveal surface is fed by a real SSE stream (/api/chat) through the
  // shared StreamEvent reducer. `status`/`thinking` carry the live agent activity.
  const {
    state,
    replay,
    status,
    thinking,
    artifacts,
    chips,
    closing,
    dataMode,
  } = useStreamingChat(scenario, { enabled: screen === "chat" && !showFirstRun });
  const { step, typed } = state;
  const liveSuggestions = useMemo(
    () => [
      "Where am I wasting ad spend?",
      "Which platform is performing best?",
      "Why is my CPA going up?",
    ],
    [],
  );

  const refreshConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/connections", { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as {
        workspace?: { name?: string };
        connections?: Channel[];
      };
      if (payload.workspace?.name) setWorkspaceName(payload.workspace.name);
      if (payload.connections?.length) setChannels(payload.connections);
    } catch (err) {
      console.warn("[connections] failed to refresh connection status", err);
    }
  }, []);

  useEffect(() => {
    setChannels(REAL_CONNECTOR_CHANNELS);
    void refreshConnections();
  }, [refreshConnections]);

  useEffect(() => {
    if (!realProductMode) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("connect")) return;
    void refreshConnections();
    window.history.replaceState({}, "", window.location.pathname);
  }, [realProductMode, refreshConnections]);

  const ask = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setActiveClient(null);
      setQuestion(trimmed);
      setScenario(resolveScenario(trimmed, persona, SCENARIOS));
      replay();
    },
    [persona, replay],
  );

  const selectChat = useCallback(
    (index: number) => {
      setActiveChat(index);
      setActiveClient(null);
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
      if (!realProductMode) {
        setChannels(
          REAL_CONNECTOR_CHANNELS.map((channel) => ({
            ...channel,
            status: intake.channels.includes(channel.name) ? "connected" : "disconnected",
          })),
        );
      }
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

  const connectChannel = useCallback((channel: Channel) => {
    if (channel.platform) {
      window.location.href = `/api/connect/${channel.platform}`;
      return;
    }
    setChannels((prev) =>
      prev.map((ch) =>
        ch.name === channel.name
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
        channels={realChannels}
        account={sidebarAccount}
        showClients={persona === "agency"}
        onViewClients={() => setScreen("clients")}
        onNewChat={replay}
        onStartPlan={() => (realProductMode ? setModalOpen(true) : setScreen("onboarding"))}
        onOpenModal={() => setModalOpen(true)}
        hideRecent={realProductMode}
        primaryActionLabel={realProductMode ? "Connect data" : "New plan"}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {showFirstRun ? (
          <FirstRunScreen channels={realChannels} onConnect={connectChannel} />
        ) : screen === "onboarding" ? (
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
              channels={realChannels}
              persona={persona}
              onSwitchPersona={switchPersona}
              onForecast={() => setScreen("forecast")}
              chatControls={screen === "chat"}
              activeClient={screen === "chat" ? activeClient : null}
              showPersonaSwitcher={!realProductMode}
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
                status={status}
                thinking={thinking}
                question={question}
                scenario={scenario}
                artifacts={artifacts}
                chips={chips}
                closing={closing}
                onSend={ask}
                onSuggest={ask}
                suggestions={realProductMode ? liveSuggestions : dataset.suggestions}
                dataMode={dataMode}
                onOpenConnections={() => setModalOpen(true)}
                connectedCount={connectedCount}
              />
            ) : mode === "thread" ? (
              <ThreadView
                step={step}
                typed={typed}
                status={status}
                thinking={thinking}
                question={question}
                scenario={scenario}
                artifacts={artifacts}
                chips={chips}
                closing={closing}
                dataMode={dataMode}
                onSend={ask}
                onSuggest={ask}
                suggestions={realProductMode ? liveSuggestions : dataset.suggestions}
                connectedCount={connectedCount}
              />
            ) : (
              <ReportView
                step={step}
                typed={typed}
                question={question}
                scenario={scenario}
                workspace={
                  realProductMode
                    ? workspaceName
                    : persona === "agency" && activeClient
                      ? activeClient
                      : dataset.workspace
                }
                artifacts={artifacts}
                closing={closing}
                dataMode={dataMode}
                onOpenConnections={() => setModalOpen(true)}
              />
            )}
          </>
        )}
      </main>

      {modalOpen && (
        <ConnectionsModal
          channels={channels}
          onClose={() => setModalOpen(false)}
          onConnect={connectChannel}
        />
      )}
    </div>
  );
}
