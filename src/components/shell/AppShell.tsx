"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Channel, ChatTurn } from "@/types/views";
import type { ArtifactPayload } from "@/lib/streaming/events";
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
import { ConnectionsModal } from "@/components/modals/ConnectionsModal";
import { OnboardingScreen } from "@/components/screens/OnboardingScreen";
import { ForecastScreen } from "@/components/screens/ForecastScreen";
import { ClientsScreen } from "@/components/screens/ClientsScreen";
import { FirstRunScreen } from "@/components/screens/FirstRunScreen";
import { WelcomeScreen } from "@/components/screens/WelcomeScreen";

type Screen = "chat" | "onboarding" | "forecast" | "clients";

const REAL_CONNECTOR_CHANNELS: Channel[] = [
  // Paid ads
  { name: "Google Ads", platform: "google_ads", category: "paid", status: "disconnected" },
  { name: "Meta Ads", platform: "meta_ads", category: "paid", status: "disconnected" },
  { name: "TikTok Ads", platform: "tiktok_ads", category: "paid", status: "disconnected" },
  { name: "LinkedIn Ads", platform: "linkedin_ads", category: "paid", status: "disconnected" },
  { name: "Microsoft Ads", platform: "microsoft_ads", category: "paid", status: "disconnected" },
  { name: "Pinterest Ads", platform: "pinterest_ads", category: "paid", status: "disconnected" },
  { name: "Snapchat Ads", platform: "snapchat_ads", category: "paid", status: "disconnected" },
  { name: "Reddit Ads", platform: "reddit_ads", category: "paid", status: "disconnected" },
  { name: "X (Twitter) Ads", platform: "x_ads", category: "paid", status: "disconnected" },
  { name: "Amazon Ads", platform: "amazon_ads", category: "paid", status: "disconnected" },
  { name: "Apple Search Ads", platform: "apple_search_ads", category: "paid", status: "disconnected" },
  // Organic / SEO
  { name: "Google Analytics 4", platform: "ga4", category: "organic", status: "disconnected" },
  { name: "Google Search Console", platform: "search_console", category: "organic", status: "disconnected" },
];

const DEMO_MODE = process.env.NEXT_PUBLIC_MARPIN_DEMO_MODE === "true";

/**
 * In the real product the user's ACTUAL question must reach the live agent — not
 * a canned demo scenario. resolveScenario() is a demo-only construct that maps a
 * query to a pre-written answer (and replaces `.question` with the canned one),
 * which is why typing a URL was getting answered as "wasted ad spend". This wraps
 * the raw input as a live scenario: the agent generates the lead + canvas cards.
 */
function liveScenario(text: string, persona: Persona): Scenario {
  return {
    id: "live",
    persona,
    title: text.length > 48 ? text.slice(0, 46) + "…" : text,
    question: text,
    keywords: [],
    lead: "",
    chips: [],
    artifacts: [],
    closing: { split: "", thread: "" },
  };
}

/** Compact note of the canvas cards an answer rendered, for conversation memory. */
function summarizeCards(artifacts: ArtifactPayload[]): string {
  const titles = artifacts
    .map((a) => (a.kind === "brief" ? a.data.title : a.kind))
    .filter(Boolean);
  return titles.length ? ` [Rendered canvas card(s): ${titles.join("; ")}]` : "";
}

/**
 * Top-level orchestrator. Owns the active persona + dataset, the top-level
 * screen, view mode, the active question + resolved scenario, the agency's
 * active client, channels, the modal, and recent-chat selection.
 */
export function AppShell() {
  const [persona, setPersona] = useState<Persona>("founder");
  const [screen, setScreen] = useState<Screen>("chat");
  const [scenario, setScenario] = useState<Scenario>(() => defaultScenarioFor("founder", SCENARIOS));
  const [question, setQuestion] = useState(scenario.question);
  const [channels, setChannels] = useState<Channel[]>(REAL_CONNECTOR_CHANNELS);
  const [workspaceName, setWorkspaceName] = useState("Personal workspace");
  const [modalOpen, setModalOpen] = useState(false);
  const [activeChat, setActiveChat] = useState(0);
  const [activeClient, setActiveClient] = useState<string | null>(null);
  const [founderConfig, setFounderConfig] = useState<ForecastConfig>(DEFAULT_FORECAST);
  // "auto" = conservative router (Sonnet floor; Haiku for trivial lookups, Opus
  // for deep strategy). Picking a specific model in the TopBar forces it.
  const [model, setModel] = useState("auto");
  // Real product opens on a clean welcome, not a canned auto-answered question.
  // Flips true the first time the user actually asks something.
  const [hasAsked, setHasAsked] = useState(false);
  // Completed conversation turns (multi-turn memory); reset on a new conversation.
  const [turns, setTurns] = useState<ChatTurn[]>([]);

  const dataset = PERSONAS[persona];
  const realProductMode = !DEMO_MODE;
  const realChannels = channels;
  const connectedCount = realChannels.filter((channel) => channel.status === "connected").length;
  const showFirstRun = realProductMode && connectedCount === 0 && screen === "chat";
  const idle = realProductMode && screen === "chat" && !showFirstRun && !hasAsked;
  const sidebarAccount = realProductMode
    ? { name: workspaceName, sub: "Marpin workspace", initials: workspaceName.slice(0, 2).toUpperCase() }
    : dataset.account;
  // The staged-reveal surface is fed by a real SSE stream (/api/chat) through the
  // shared StreamEvent reducer. `status`/`thinking` carry the live agent activity.
  // Last ~10 turns become the agent's conversational memory (sent to /api/chat).
  const history = useMemo(
    () =>
      turns.slice(-10).flatMap((t) => [
        { role: "user" as const, content: t.question },
        { role: "assistant" as const, content: t.answer },
      ]),
    [turns],
  );
  const {
    state,
    replay,
    status,
    thinking,
    artifacts,
    chips,
    choices,
    closing,
    dataMode,
  } = useStreamingChat(scenario, {
    enabled: screen === "chat" && !showFirstRun && !idle,
    model,
    history,
  });
  const { step, typed } = state;
  const liveSuggestions = useMemo(
    () => [
      "Build a growth strategy for my business",
      "Analyze my top competitors and where I can win",
      "Plan a campaign I can launch this month",
      "Audit my website and funnel — what should I fix first?",
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
      // Archive the just-finished answer into conversation memory before asking
      // the next question (real product = multi-turn; demo stays single-shot).
      if (realProductMode && hasAsked && typed.trim()) {
        const prevQ = question;
        const askedQ = choices ? ` (asked: ${choices.questions.map((q) => q.question).join("; ")})` : "";
        const prevA = typed.trim() + askedQ + summarizeCards(artifacts);
        setTurns((prev) => [...prev, { question: prevQ, answer: prevA }]);
      }
      setQuestion(trimmed);
      setScenario(
        realProductMode ? liveScenario(trimmed, persona) : resolveScenario(trimmed, persona, SCENARIOS),
      );
      setHasAsked(true);
      replay();
    },
    [persona, realProductMode, replay, hasAsked, typed, question, artifacts, choices],
  );

  // "New conversation" returns the real product to the clean welcome state
  // rather than re-streaming the previous answer (demo keeps the replay).
  const newChat = useCallback(() => {
    setActiveClient(null);
    setTurns([]);
    if (realProductMode) {
      setHasAsked(false);
      return;
    }
    replay();
  }, [realProductMode, replay]);

  const selectChat = useCallback(
    (index: number) => {
      setActiveChat(index);
      setActiveClient(null);
      const q = PERSONAS[persona].recentChats[index].question;
      setQuestion(q);
      setScenario(resolveScenario(q, persona, SCENARIOS));
      setHasAsked(true);
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
      setHasAsked(true);
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
      setScreen("chat");
      setHasAsked(true);
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
      setHasAsked(true);
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
        onNewChat={newChat}
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
              onReplay={replay}
              title={idle ? "New conversation" : screen === "clients" ? "Clients" : scenario.title}
              channels={realChannels}
              persona={persona}
              onSwitchPersona={switchPersona}
              onForecast={() => setScreen("forecast")}
              chatControls={screen === "chat"}
              activeClient={screen === "chat" ? activeClient : null}
              showPersonaSwitcher={!realProductMode}
              model={model}
              onModelChange={setModel}
            />

            {idle ? (
              <WelcomeScreen
                onSend={ask}
                onSuggest={ask}
                suggestions={realProductMode ? liveSuggestions : dataset.suggestions}
                connectedCount={connectedCount}
              />
            ) : screen === "clients" ? (
              <ClientsScreen
                clients={AGENCY_CLIENTS}
                workspace={dataset.workspace}
                onOpenClient={openClient}
              />
            ) : (
              <SplitView
                step={step}
                turns={turns}
                choices={choices}
                onChoose={ask}
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
