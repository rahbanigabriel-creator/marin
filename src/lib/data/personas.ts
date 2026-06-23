import type { Channel, RecentChat } from "@/types/views";
import type { Persona } from "@/types/scenario";
import { DEFAULT_CHANNELS, DEFAULT_QUESTION, RECENT_CHATS } from "@/lib/data/canonical";

/** Identity shown in the sidebar account row + menu. */
export interface Account {
  name: string;
  sub: string;
  initials: string;
}

export interface PersonaConfig {
  /** label shown in the persona switcher */
  label: string;
  workspace: string;
  account: Account;
  channels: Channel[];
  recentChats: RecentChat[];
  suggestions: string[];
}

/** Canonical question strings (kept in sync with the scenario registry). */
const Q = {
  wasted: DEFAULT_QUESTION,
  compare: "Which platform is performing best?",
  health: "Is my marketing working — should I cut or raise budget?",
  why: "Why is my CPA going up?",
  tracking: "Do I have a tracking problem?",
  // Broad, no-data-required starters — Marpin is a full CMO, not a metrics box.
  strategy: "Build a growth strategy for my business",
  competitors: "Analyze my top competitors and where I can win",
  website: "Audit my website and funnel — what should I fix first?",
  launch: "Plan a campaign I can launch this month",
  channelmix: "What's the best channel mix for my budget?",
};

function channels(connected: string[]): Channel[] {
  const all = ["Google Ads", "Meta Ads", "GA4", "Search Console", "TikTok Ads", "LinkedIn Ads"];
  return all.map((name) => ({
    name,
    status: connected.includes(name) ? "connected" : "disconnected",
  }));
}

export const PERSONA_ORDER: Persona[] = ["founder", "cmo", "ceo", "agency"];

export const PERSONAS: Record<Persona, PersonaConfig> = {
  founder: {
    label: "Solo founder",
    workspace: "Northwind",
    account: { name: "Alex Lemoine", sub: "Northwind · Founder", initials: "AL" },
    channels: DEFAULT_CHANNELS,
    recentChats: RECENT_CHATS,
    suggestions: [Q.strategy, Q.competitors, Q.launch],
  },
  cmo: {
    label: "Marketing lead",
    workspace: "Lumen",
    account: { name: "Priya Shah", sub: "Lumen · CMO", initials: "PS" },
    channels: channels(["Google Ads", "Meta Ads", "GA4", "Search Console", "TikTok Ads"]),
    recentChats: [
      { title: "Which platform is winning", question: Q.compare },
      { title: "Is marketing working?", question: Q.health },
      { title: "Wasted ad spend audit", question: Q.wasted },
    ],
    suggestions: [Q.channelmix, Q.competitors, Q.compare],
  },
  ceo: {
    label: "Executive",
    workspace: "Vertex",
    account: { name: "Daniel Roy", sub: "Vertex · CEO", initials: "DR" },
    channels: channels(["Google Ads", "Meta Ads", "GA4"]),
    recentChats: [
      { title: "Is marketing working?", question: Q.health },
      { title: "Which platform is winning", question: Q.compare },
      { title: "Q3 board readout", question: Q.health },
    ],
    suggestions: [Q.strategy, Q.health, Q.compare],
  },
  agency: {
    label: "Agency",
    workspace: "Brightline",
    account: { name: "Sam Okafor", sub: "Brightline · Growth", initials: "SO" },
    channels: channels(["Google Ads", "Meta Ads", "GA4", "Search Console", "TikTok Ads", "LinkedIn Ads"]),
    recentChats: [
      { title: "Why is CPA rising?", question: Q.why },
      { title: "Tracking health check", question: Q.tracking },
      { title: "Wasted ad spend audit", question: Q.wasted },
      { title: "Which platform is winning", question: Q.compare },
    ],
    suggestions: [Q.competitors, Q.launch, Q.website],
  },
};
