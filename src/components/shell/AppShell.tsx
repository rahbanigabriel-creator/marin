"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Channel,
  ChatTurn,
  ConnectionDisconnectResult,
  ProviderRevocationStatus,
} from "@/types/views";
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
import { CampaignsScreen } from "@/components/screens/CampaignsScreen";
import { WelcomeScreen } from "@/components/screens/WelcomeScreen";
import { BrandWorkspace } from "@/components/screens/BrandWorkspace";
import { OrganicPlanner } from "@/components/organic";
import { AgentRunsWorkspace } from "@/components/agents";
import { DistributionAnalytics } from "@/components/analytics/DistributionAnalytics";
import type { BillingSnapshotDto } from "@/lib/billing/types";
import {
  PRODUCT_PLATFORMS,
  isLaunchConnectorPlatform,
  type ProductMode,
} from "@/lib/product/platforms";
import type {
  ConversationDto,
  ConversationSummaryDto,
} from "@/lib/conversations/types";
import { restoreConversation } from "@/lib/conversations/client";
import type { ResultChip } from "@/types/artifacts";
import type { BrandDto, BrandWriteInput } from "@/lib/brand/types";
import { auditFailureMessage, readAuditResponse } from "@/lib/audit/client-error";
import {
  parseWorkspaceLocation,
  workspaceLocationHref,
  type WorkspaceLocation,
} from "@/lib/product/navigation";

type Screen =
  | "chat"
  | "brand"
  | "organic"
  | "analytics"
  | "agents"
  | "onboarding"
  | "forecast"
  | "clients"
  | "dashboard";

const PRODUCT_CHANNELS: Channel[] = PRODUCT_PLATFORMS
  .filter(
    (platform) =>
      platform.connectorPlatform && isLaunchConnectorPlatform(platform.connectorPlatform),
  )
  .map((platform) => ({
    name: platform.label,
    platform: platform.id,
    connectorPlatform: platform.connectorPlatform,
    category: platform.section,
    connectionAvailability: platform.capabilities.connect,
    description: platform.description,
    configured: false,
    status: "disconnected",
  }));

const DEMO_MODE = process.env.NEXT_PUBLIC_MARPIN_DEMO_MODE === "true";

function writeWorkspaceLocation(location: WorkspaceLocation, replace = false): void {
  if (typeof window === "undefined") return;
  const href = workspaceLocationHref(location);
  if (replace) window.history.replaceState({}, "", href);
  else window.history.pushState({}, "", href);
}

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

function chatTitle(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "New conversation";
  return trimmed.length > 34 ? trimmed.slice(0, 32) + "…" : trimmed;
}

function looksLikeWebsite(value: string): boolean {
  const candidate = value.trim();
  if (!candidate || /\s/.test(candidate)) return false;
  try {
    const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/**
 * Top-level orchestrator. Owns the active persona + dataset, the top-level
 * screen, view mode, the active question + resolved scenario, the agency's
 * active client, channels, the modal, and recent-chat selection.
 */
export function AppShell({ authEnabled = false }: { authEnabled?: boolean }) {
  const [persona, setPersona] = useState<Persona>("founder");
  const [screen, setScreen] = useState<Screen>("chat");
  const [scenario, setScenario] = useState<Scenario>(() => defaultScenarioFor("founder", SCENARIOS));
  const [question, setQuestion] = useState(scenario.question);
  const [channels, setChannels] = useState<Channel[]>(PRODUCT_CHANNELS);
  const [workspaceName, setWorkspaceName] = useState("Personal workspace");
  const [modalOpen, setModalOpen] = useState(false);
  const [activeChat, setActiveChat] = useState(0);
  const [activeClient, setActiveClient] = useState<string | null>(null);
  const [founderConfig, setFounderConfig] = useState<ForecastConfig>(DEFAULT_FORECAST);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [productMode, setProductMode] = useState<ProductMode | "assistant">("assistant");
  // "auto" = conservative router. Picking a specific model in the composer
  // forces it; Extra/Opus stays disabled in the UI for now.
  const [model, setModel] = useState("auto");
  // Real product opens on a clean welcome, not a canned auto-answered question.
  // Flips true the first time the user actually asks something.
  const [hasAsked, setHasAsked] = useState(false);
  // Completed conversation turns (multi-turn memory); reset on a new conversation.
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [conversations, setConversations] = useState<ConversationSummaryDto[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [streamEnabled, setStreamEnabled] = useState(false);
  const [restoredAnswer, setRestoredAnswer] = useState("");
  const [restoredArtifacts, setRestoredArtifacts] = useState<ArtifactPayload[]>([]);
  const [restoredChips, setRestoredChips] = useState<ResultChip[]>([]);
  const [restoredChoices, setRestoredChoices] = useState<{
    questions: { question: string; options: string[] }[];
  } | null>(null);
  const [restoredClosing, setRestoredClosing] = useState<Scenario["closing"] | null>(null);
  const [restoredDataMode, setRestoredDataMode] = useState<"live" | "empty" | "sample">("empty");
  const [brand, setBrand] = useState<BrandDto | null>(null);
  const [brandBusy, setBrandBusy] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [auditUrl, setAuditUrl] = useState("");
  const [billing, setBilling] = useState<BillingSnapshotDto | null>(null);

  const dataset = PERSONAS[persona];
  const realProductMode = !DEMO_MODE;
  const workspaceCanManage = billing?.canManage !== false;
  const workspaceReadOnly = !workspaceCanManage;
  const realChannels = channels;
  const connectedCount = realProductMode
    ? new Set(
        realChannels
          .filter((channel) => channel.connectionId && channel.status !== "disconnected")
          .map((channel) => channel.connectionId),
      ).size
    : realChannels.filter((channel) => channel.status === "connected").length;
  const idle = realProductMode && screen === "chat" && !hasAsked;
  const sidebarAccount = realProductMode
    ? { name: workspaceName, sub: "Marpin workspace", initials: workspaceName.slice(0, 2).toUpperCase() }
    : dataset.account;
  const realRecentChats = useMemo(
    () => [
      {
        id: conversationId ?? undefined,
        title: hasAsked ? chatTitle(question) : "New conversation",
        question: hasAsked ? question : "",
        mode: productMode === "organic" ? ("organic" as const) : ("assistant" as const),
      },
      ...conversations
        .filter((conversation) => conversation.id !== conversationId)
        .map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          question: conversation.preview ?? conversation.title,
          mode: conversation.mode,
        })),
    ],
    [conversationId, conversations, hasAsked, productMode, question],
  );
  const sidebarChats = realProductMode ? realRecentChats : dataset.recentChats;
  // The staged-reveal surface is fed by a real SSE stream (/api/chat) through the
  // shared StreamEvent reducer. Concise status events carry live agent activity;
  // provider reasoning never enters the public event contract.
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
    stop,
    isStreaming,
    status,
    artifacts,
    chips,
    choices,
    conversation: streamedConversation,
    closing,
    dataMode,
    error,
    errorAction,
    done,
  } = useStreamingChat(scenario, {
    enabled: screen === "chat" && !idle && streamEnabled,
    model,
    history,
    conversationId,
    turnId,
    mode: productMode === "organic" ? "organic" : productMode === "paid" ? "paid" : "assistant",
  });
  const { step, typed } = state;
  const displayStep = streamEnabled ? step : restoredAnswer ? 7 : step;
  const displayTyped = streamEnabled ? typed : restoredAnswer;
  const displayArtifacts = streamEnabled ? artifacts : restoredArtifacts;
  const displayChips = streamEnabled ? chips : restoredChips;
  const displayChoices = streamEnabled ? choices : restoredChoices;
  const displayClosing = streamEnabled ? closing : restoredClosing;
  const displayDataMode = streamEnabled ? dataMode : restoredDataMode;
  const displayStatus = streamEnabled ? status : null;
  const displayError = streamEnabled ? error : null;
  const displayDone = streamEnabled ? done : Boolean(restoredAnswer);
  const liveSuggestions = useMemo(
    () =>
      productMode === "organic"
        ? [
            "Build a 30-day organic content plan",
            "Audit my SEO and prioritize the fixes",
            "Plan next week's posts across my channels",
            "Turn one product idea into seven platform posts",
          ]
        : [
            "Build a growth strategy for my business",
            "Analyze my top competitors and where I can win",
            "Plan a paid campaign I can launch this month",
            "Audit my website and funnel — what should I fix first?",
          ],
    [productMode],
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
      if (Array.isArray(payload.connections)) {
        const incomingByPlatform = new Map<string, Channel[]>();
        for (const channel of payload.connections) {
          if (!channel.platform) continue;
          const accounts = incomingByPlatform.get(channel.platform) ?? [];
          accounts.push(channel);
          incomingByPlatform.set(channel.platform, accounts);
        }
        setChannels(PRODUCT_CHANNELS.flatMap((base) => {
          const incoming = base.platform ? incomingByPlatform.get(base.platform) : undefined;
          return incoming?.length
            ? incoming.map((account) => ({ ...base, ...account }))
            : [{ ...base }];
        }));
      }
    } catch {
      console.warn("[connections] failed to refresh connection status");
    }
  }, []);

  const refreshConversations = useCallback(async () => {
    if (!realProductMode) return;
    try {
      const response = await fetch("/api/conversations", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        conversations?: ConversationSummaryDto[];
      };
      setConversations(payload.conversations ?? []);
    } catch {
      // Persistence is additive; the in-memory chat remains usable while its
      // migration is rolling out or the database is temporarily unavailable.
    }
  }, [realProductMode]);

  const refreshBrand = useCallback(async () => {
    if (!realProductMode) return;
    try {
      const response = await fetch("/api/brands", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { brands?: BrandDto[] };
      setBrand(payload.brands?.find((item) => item.isPrimary) ?? payload.brands?.[0] ?? null);
    } catch {
      // Brand persistence is additive and may be unavailable during migration.
    }
  }, [realProductMode]);

  const refreshBilling = useCallback(async () => {
    if (!realProductMode) return;
    try {
      const response = await fetch("/api/billing", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { billing?: BillingSnapshotDto };
      if (payload.billing) setBilling(payload.billing);
    } catch {
      // Keep the last confirmed permissions when a background refresh fails.
    }
  }, [realProductMode]);

  useEffect(() => {
    setChannels(PRODUCT_CHANNELS);
    void refreshConnections();
    void refreshConversations();
    void refreshBrand();
    void refreshBilling();
  }, [refreshBilling, refreshBrand, refreshConnections, refreshConversations]);

  useEffect(() => {
    if (!streamedConversation) return;
    setConversationId(streamedConversation.id);
    void refreshConversations();
  }, [refreshConversations, streamedConversation]);

  useEffect(() => {
    if (!done || !streamEnabled) return;
    void refreshConversations();
    void refreshBilling();
  }, [done, refreshBilling, refreshConversations, streamEnabled]);

  useEffect(() => {
    if (model === "claude-opus-4-8" && !billing?.entitlements.canUseOpus) setModel("auto");
  }, [billing?.entitlements.canUseOpus, model]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const sync = () => setSidebarCollapsed(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!realProductMode) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("connect")) return;
    void refreshConnections();
    // A platform just connected → pull its data now rather than waiting for the
    // 6-hourly Inngest cron, then refresh the connection list again.
    if (params.get("connect") === "connected") {
      void fetch("/api/sync", { method: "POST" })
        .then(() => refreshConnections())
        .catch(() => {});
    } else if (params.get("connect") === "connection_limit") {
      setModalOpen(true);
      void refreshBilling();
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [realProductMode, refreshBilling, refreshConnections]);

  const ask = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setScreen("chat");
      setActiveChat(0);
      setActiveClient(null);
      // Archive the just-finished answer into conversation memory before asking
      // the next question (real product = multi-turn; demo stays single-shot).
      if (realProductMode && hasAsked && displayTyped.trim()) {
        const prevQ = question;
        const askedQ = displayChoices
          ? ` (asked: ${displayChoices.questions.map((q) => q.question).join("; ")})`
          : "";
        const prevA = displayTyped.trim() + askedQ + summarizeCards(displayArtifacts);
        setTurns((prev) => [...prev, { question: prevQ, answer: prevA }]);
      }
      setTurnId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
      setRestoredAnswer("");
      setRestoredArtifacts([]);
      setRestoredChips([]);
      setRestoredChoices(null);
      setRestoredClosing(null);
      setRestoredDataMode("empty");
      setStreamEnabled(true);
      setQuestion(trimmed);
      setScenario(
        realProductMode ? liveScenario(trimmed, persona) : resolveScenario(trimmed, persona, SCENARIOS),
      );
      setHasAsked(true);
      replay();
    },
    [
      persona,
      realProductMode,
      replay,
      hasAsked,
      displayTyped,
      question,
      displayArtifacts,
      displayChoices,
    ],
  );

  const auditWebsite = useCallback(async (url: string): Promise<void> => {
    const candidate = url.trim();
    if (!candidate) return;
    setAuditUrl(candidate);
    setBrandBusy(true);
    setBrandError(null);
    setScreen("brand");
    writeWorkspaceLocation({ area: "brand" });
    try {
      const response = await fetch("/api/brands/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: candidate }),
      });
      const payload = await readAuditResponse<{ brand: BrandDto }>(response);
      if (!response.ok || !payload.brand) {
        throw new Error(auditFailureMessage(response.status, payload));
      }
      setBrand(payload.brand);
      setAuditUrl(payload.brand.websiteUrl ?? candidate);
    } catch (auditError) {
      setBrandError(
        auditError instanceof Error ? auditError.message : "Marpin could not audit this website.",
      );
    } finally {
      setBrandBusy(false);
    }
  }, []);

  const saveBrand = useCallback(async (brandId: string, input: BrandWriteInput): Promise<void> => {
    setBrandBusy(true);
    setBrandError(null);
    try {
      const response = await fetch(`/api/brands/${encodeURIComponent(brandId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as { brand?: BrandDto; error?: string };
      if (!response.ok || !payload.brand) {
        throw new Error(payload.error || "Marpin could not save this brand.");
      }
      setBrand(payload.brand);
    } catch (saveError) {
      setBrandError(saveError instanceof Error ? saveError.message : "Marpin could not save this brand.");
    } finally {
      setBrandBusy(false);
    }
  }, []);

  const submitWelcome = useCallback(
    (text: string) => {
      if (realProductMode && !brand && looksLikeWebsite(text)) {
        void auditWebsite(text);
        return;
      }
      ask(text);
    },
    [ask, auditWebsite, brand, realProductMode],
  );

  // Deep-link from the landing hero: /app?q=<website> auto-starts the analysis,
  // then strips the param so a reload doesn't re-run it. Fires once.
  const didDeepLink = useRef(false);
  useEffect(() => {
    if (didDeepLink.current) return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q && q.trim()) {
      didDeepLink.current = true;
      submitWelcome(q.trim());
      const url = new URL(window.location.href);
      url.searchParams.delete("q");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, [submitWelcome]);

  // "New conversation" returns the real product to the clean welcome state
  // rather than re-streaming the previous answer (demo keeps the replay).
  const newChat = useCallback(() => {
    stop();
    setScreen("chat");
    setProductMode("assistant");
    setActiveChat(0);
    setActiveClient(null);
    setTurns([]);
    setConversationId(null);
    setTurnId(null);
    setStreamEnabled(false);
    setRestoredAnswer("");
    setRestoredArtifacts([]);
    setRestoredChips([]);
    setRestoredChoices(null);
    setRestoredClosing(null);
    writeWorkspaceLocation({ area: "assistant" });
    if (realProductMode) {
      setHasAsked(false);
      return;
    }
    replay();
  }, [realProductMode, replay, stop]);

  const parkCurrentAnswer = useCallback(() => {
    if (hasAsked && displayTyped.trim()) {
      const askedQ = displayChoices
        ? ` (asked: ${displayChoices.questions.map((item) => item.question).join("; ")})`
        : "";
      setTurns((previous) => [
        ...previous,
        { question, answer: displayTyped.trim() + askedQ + summarizeCards(displayArtifacts) },
      ]);
    }
    stop();
    setHasAsked(false);
    setActiveChat(0);
    setConversationId(null);
    setTurnId(null);
    setTurns([]);
    setStreamEnabled(false);
    setRestoredAnswer("");
    setRestoredArtifacts([]);
    setRestoredChips([]);
    setRestoredChoices(null);
    setRestoredClosing(null);
  }, [displayArtifacts, displayChoices, displayTyped, hasAsked, question, stop]);

  const openAssistant = useCallback(() => {
    if (productMode === "assistant" && screen === "chat") return;
    parkCurrentAnswer();
    setProductMode("assistant");
    setScreen("chat");
    setActiveClient(null);
    writeWorkspaceLocation({ area: "assistant" });
  }, [parkCurrentAnswer, productMode, screen]);

  const openOrganic = useCallback(() => {
    if (productMode === "organic" && screen === "organic") return;
    parkCurrentAnswer();
    setProductMode("organic");
    setScreen("organic");
    setActiveClient(null);
    writeWorkspaceLocation({ area: "organic", view: "calendar" });
  }, [parkCurrentAnswer, productMode, screen]);

  const openBrand = useCallback(() => {
    if (screen === "brand") return;
    stop();
    setScreen("brand");
    setActiveClient(null);
    setBrandError(null);
    writeWorkspaceLocation({ area: "brand" });
  }, [screen, stop]);

  const openPaid = useCallback(() => {
    if (productMode === "paid" && screen === "dashboard") return;
    parkCurrentAnswer();
    setProductMode("paid");
    setScreen("dashboard");
    setActiveClient(null);
    writeWorkspaceLocation({ area: "paid", view: "campaigns" });
  }, [parkCurrentAnswer, productMode, screen]);

  const openAgents = useCallback(() => {
    if (screen === "agents") return;
    parkCurrentAnswer();
    setScreen("agents");
    setActiveClient(null);
    writeWorkspaceLocation({ area: "agents" });
  }, [parkCurrentAnswer, screen]);

  const openAnalytics = useCallback(() => {
    if (screen === "analytics") return;
    parkCurrentAnswer();
    setScreen("analytics");
    setActiveClient(null);
    writeWorkspaceLocation({ area: "analytics" });
  }, [parkCurrentAnswer, screen]);

  useEffect(() => {
    if (!realProductMode) return;
    const restoreLocation = () => {
      const location = parseWorkspaceLocation(window.location.search);
      stop();
      setActiveClient(null);
      if (location.area === "brand") {
        setProductMode("assistant");
        setScreen("brand");
      } else if (location.area === "organic") {
        setProductMode("organic");
        setScreen(location.view === "assistant" ? "chat" : "organic");
      } else if (location.area === "paid") {
        setProductMode("paid");
        setScreen("dashboard");
      } else if (location.area === "analytics") {
        setProductMode("assistant");
        setScreen("analytics");
      } else if (location.area === "agents") {
        setProductMode("assistant");
        setScreen("agents");
      } else {
        setProductMode("assistant");
        setScreen("chat");
      }
    };

    restoreLocation();
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, [realProductMode, stop]);

  const selectChat = useCallback(
    async (index: number) => {
      setScreen("chat");
      setActiveClient(null);
      if (realProductMode) {
        if (index <= 0) {
          setActiveChat(0);
          return;
        }
        const selected = realRecentChats[index];
        if (!selected?.id) {
          setActiveChat(0);
          return;
        }
        stop();
        const response = await fetch(`/api/conversations/${encodeURIComponent(selected.id)}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { conversation?: ConversationDto };
        if (!payload.conversation) return;
        const restored = restoreConversation(payload.conversation);
        setActiveChat(0);
        setConversationId(payload.conversation.id);
        setTurnId(restored.turnId);
        setTurns(restored.turns);
        setQuestion(restored.question);
        setScenario(liveScenario(restored.question, persona));
        setRestoredAnswer(restored.answer);
        setRestoredArtifacts(restored.artifacts);
        setRestoredChips(restored.chips);
        setRestoredChoices(restored.choices);
        setRestoredClosing(restored.closing);
        setRestoredDataMode(restored.dataMode);
        setStreamEnabled(false);
        const restoredMode = payload.conversation.mode === "organic" ? "organic" : "assistant";
        setProductMode(restoredMode);
        writeWorkspaceLocation(
          restoredMode === "organic"
            ? { area: "organic", view: "assistant" }
            : { area: "assistant" },
        );
        setHasAsked(true);
        return;
      }
      setProductMode("assistant");
      setActiveChat(index);
      const q = PERSONAS[persona].recentChats[index].question;
      setQuestion(q);
      setScenario(resolveScenario(q, persona, SCENARIOS));
      setHasAsked(true);
      replay();
    },
    [persona, realProductMode, realRecentChats, replay, stop],
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
      setPersona("founder");
      // A freshly-onboarded founder only has the channels they actually picked.
      if (!realProductMode) {
        setChannels(
          PRODUCT_CHANNELS.map((channel) => ({
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
    [realProductMode, replay],
  );

  const connectChannel = useCallback((channel: Channel) => {
    if (channel.configured === false) {
      setModalOpen(true);
      return;
    }
    if (channel.connectorPlatform) {
      window.location.href = `/api/connect/${channel.connectorPlatform}`;
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

  const disconnectChannel = useCallback(
    async (channel: Channel): Promise<ConnectionDisconnectResult> => {
      if (!channel.connectionId) {
        throw new Error("This account is no longer connected.");
      }
      const response = await fetch(
        `/api/connections/${encodeURIComponent(channel.connectionId)}`,
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        connectionId?: string;
        disconnected?: boolean;
        providerRevocation?: ProviderRevocationStatus;
        message?: string;
      } | null;

      if (!response.ok) {
        const fallback = response.status === 403
          ? "Only workspace owners and admins can disconnect accounts."
          : response.status === 404
            ? "This connection no longer exists."
            : "Marpin could not disconnect this account.";
        throw new Error(payload?.message ?? fallback);
      }
      if (
        payload?.disconnected !== true ||
        payload.connectionId !== channel.connectionId ||
        !["confirmed", "retained", "failed", "unavailable"].includes(payload.providerRevocation ?? "")
      ) {
        throw new Error("Marpin received an invalid disconnect response.");
      }

      await Promise.all([refreshConnections(), refreshBilling()]);
      return payload as ConnectionDisconnectResult;
    },
    [refreshBilling, refreshConnections],
  );

  const retryCurrent = useCallback(() => {
    if (!turnId) {
      setTurnId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    }
    setRestoredAnswer("");
    setRestoredArtifacts([]);
    setRestoredChips([]);
    setRestoredChoices(null);
    setRestoredClosing(null);
    setRestoredDataMode("empty");
    setStreamEnabled(true);
    replay();
  }, [replay, turnId]);

  const askFromOrganicPlanner = useCallback(
    (prompt: string) => {
      setProductMode("organic");
      writeWorkspaceLocation({ area: "organic", view: "assistant" });
      ask(prompt);
    },
    [ask],
  );

  return (
    <div className="flex h-[100dvh] w-screen overflow-hidden bg-surface-page">
      <Sidebar
        activeChat={activeChat}
        onSelectChat={selectChat}
        recentChats={sidebarChats}
        account={sidebarAccount}
        showClients={persona === "agency"}
        onViewClients={() => setScreen("clients")}
        onViewDashboard={realProductMode ? openPaid : undefined}
        onViewAssistant={realProductMode ? openAssistant : undefined}
        onViewOrganic={realProductMode ? openOrganic : undefined}
        onViewBrand={realProductMode ? openBrand : undefined}
        onViewAnalytics={realProductMode ? openAnalytics : undefined}
        onViewAgents={realProductMode ? openAgents : undefined}
        activeArea={screen === "brand"
          ? "brand"
          : screen === "analytics"
            ? "analytics"
            : screen === "agents"
              ? "agents"
              : productMode}
        onNewChat={newChat}
        onStartPlan={() => (realProductMode ? setModalOpen(true) : setScreen("onboarding"))}
        onOpenModal={() => setModalOpen(true)}
        primaryActionLabel={realProductMode ? "Manage connections" : "New plan"}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        authEnabled={authEnabled}
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
              onReplay={DEMO_MODE ? replay : undefined}
              title={
                idle
                  ? productMode === "organic"
                    ? "Organic + SEO"
                    : "New conversation"
                  : screen === "clients"
                    ? "Clients"
                    : screen === "dashboard"
                      ? "Campaigns"
                    : screen === "analytics"
                      ? "Analytics"
                      : screen === "agents"
                        ? "Agent runs"
                      : screen === "brand"
                        ? "Brand"
                        : screen === "organic"
                          ? "Content planner"
                      : scenario.title
              }
              channels={realChannels}
              persona={persona}
              onSwitchPersona={switchPersona}
              onForecast={DEMO_MODE ? () => setScreen("forecast") : undefined}
              chatControls={screen === "chat"}
              activeClient={screen === "chat" ? activeClient : null}
              showPersonaSwitcher={!realProductMode}
            />

            {screen === "brand" ? (
              <BrandWorkspace
                brand={brand}
                initialUrl={auditUrl}
                busy={brandBusy}
                error={brandError}
                canManage={workspaceCanManage}
                onAudit={auditWebsite}
                onSave={saveBrand}
              />
            ) : screen === "agents" ? (
              <AgentRunsWorkspace
                brandId={brand?.id ?? null}
                canManage={workspaceCanManage}
                onOpenBrand={openBrand}
              />
            ) : screen === "analytics" ? (
              <DistributionAnalytics />
            ) : screen === "organic" ? (
              brand ? (
                <OrganicPlanner
                  brandId={brand.id}
                  timezone={brand.timezone}
                  locale={brand.locale}
                  canManagePlans={workspaceCanManage}
                  onAskAI={askFromOrganicPlanner}
                />
              ) : (
                <WelcomeScreen
                  onSend={submitWelcome}
                  onSuggest={ask}
                  suggestions={[]}
                  connectedCount={connectedCount}
                  model={model}
                  onModelChange={setModel}
                  mode="organic"
                  brandName={null}
                  canUseOpus={billing?.entitlements.canUseOpus ?? false}
                  readOnly={workspaceReadOnly}
                />
              )
            ) : idle ? (
              <WelcomeScreen
                onSend={submitWelcome}
                onSuggest={ask}
                // True first-run stays URL-first. Once Brand memory exists, the
                // clean welcome becomes a contextual strategy launchpad.
                suggestions={
                  realProductMode ? (brand ? liveSuggestions : []) : dataset.suggestions
                }
                connectedCount={connectedCount}
                model={model}
                onModelChange={setModel}
                mode={productMode === "organic" ? "organic" : "assistant"}
                brandName={brand?.name ?? null}
                canUseOpus={billing?.entitlements.canUseOpus ?? false}
                readOnly={workspaceReadOnly}
              />
            ) : screen === "clients" ? (
              <ClientsScreen
                clients={AGENCY_CLIENTS}
                workspace={dataset.workspace}
                onOpenClient={openClient}
              />
            ) : screen === "dashboard" ? (
              <CampaignsScreen
                onOpenConnections={() => setModalOpen(true)}
                canManage={workspaceCanManage}
              />
            ) : (
              <SplitView
                step={displayStep}
                turns={turns}
                choices={displayChoices}
                onChoose={ask}
                typed={displayTyped}
                status={displayStatus}
                error={displayError}
                errorAction={streamEnabled ? errorAction : null}
                isStreaming={isStreaming}
                done={displayDone}
                onStop={stop}
                onRetry={retryCurrent}
                question={question}
                scenario={scenario}
                artifacts={displayArtifacts}
                chips={displayChips}
                closing={displayClosing}
                onSend={ask}
                onSuggest={ask}
                suggestions={realProductMode ? liveSuggestions : dataset.suggestions}
                dataMode={displayDataMode}
                onOpenConnections={() => setModalOpen(true)}
                connectedCount={connectedCount}
                channels={realChannels}
                onConnect={connectChannel}
                model={model}
                onModelChange={setModel}
                canUseOpus={billing?.entitlements.canUseOpus ?? false}
                readOnly={workspaceReadOnly}
              />
            )}
          </>
        )}
      </main>

      {modalOpen && (
        <ConnectionsModal
          channels={channels}
          connectedCount={billing?.resources.connections ?? connectedCount}
          maxConnections={billing?.entitlements.maxConnections}
          planName={billing?.plan.name}
          onClose={() => setModalOpen(false)}
          onConnect={connectChannel}
          onDisconnect={disconnectChannel}
          canManage={workspaceCanManage}
        />
      )}
    </div>
  );
}
