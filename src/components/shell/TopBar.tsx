"use client";

import { useState } from "react";
import type { Channel, Mode } from "@/types/views";
import type { Persona } from "@/types/scenario";
import { PERSONAS, PERSONA_ORDER } from "@/lib/data/personas";

interface TopBarProps {
  mode: Mode;
  onSetMode: (mode: Mode) => void;
  onReplay: () => void;
  /** active conversation title */
  title: string;
  channels: Channel[];
  persona: Persona;
  onSwitchPersona: (p: Persona) => void;
  onForecast: () => void;
  /** chat-specific controls (mode tabs, forecast, replay, channel summary) */
  chatControls?: boolean;
  /** agency: the client the workspace is currently scoped to */
  activeClient?: string | null;
  showPersonaSwitcher?: boolean;
  /** selected model id + setter for the model picker (chat only). */
  model?: string;
  onModelChange?: (model: string) => void;
}

const MODEL_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
];

const TABS: Array<{ mode: Mode; label: string }> = [
  { mode: "split", label: "Split canvas" },
  { mode: "thread", label: "Thread" },
  { mode: "report", label: "Report" },
];

export function TopBar({
  mode,
  onSetMode,
  onReplay,
  title,
  channels,
  persona,
  onSwitchPersona,
  onForecast,
  chatControls = true,
  activeClient = null,
  showPersonaSwitcher = true,
  model,
  onModelChange,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const connected = channels.filter((c) => c.status === "connected").map((c) => c.name);
  const channelSummary =
    connected.length === 0
      ? "No channels connected"
      : connected.slice(0, 3).join(" · ") +
        (connected.length > 3 ? ` +${connected.length - 3}` : "");

  return (
    <header className="flex h-topbar flex-none items-center justify-between gap-[16px] border-b border-line-2 bg-surface-panel px-[20px]">
      <div className="flex min-w-0 items-center gap-[12px]">
        {showPersonaSwitcher && (
        <div className="relative flex-none">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Switch demo persona"
            aria-expanded={menuOpen}
            className="flex cursor-pointer items-center gap-[6px] rounded-pill border border-line-1 bg-surface-chip font-sans text-[12px] font-semibold text-ink-700"
            style={{ padding: "5px 10px" }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#9A3D63" }} />
            {PERSONAS[persona].label}
            <span className="text-ink-300">▾</span>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="animate-fadeUpFast absolute left-0 top-full z-50 mt-[6px] w-[230px] overflow-hidden rounded-btn border border-line-1 bg-surface-card shadow-modal">
                <div className="border-b border-line-3 p-[8px_12px] font-mono text-[10px] font-semibold tracking-[0.06em] text-ink-300">
                  DEMO PERSONA
                </div>
                {PERSONA_ORDER.map((p) => {
                  const cfg = PERSONAS[p];
                  const active = p === persona;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onSwitchPersona(p);
                      }}
                      className="flex w-full cursor-pointer items-center justify-between border-none bg-transparent p-[9px_12px] text-left hover:bg-surface-chip"
                      style={active ? { background: "#F9F9F4" } : undefined}
                    >
                      <span className="min-w-0">
                        <span className="block font-sans text-[12.5px] font-semibold text-ink-900">
                          {cfg.label}
                        </span>
                        <span className="block font-sans text-[11px] text-ink-300">
                          {cfg.account.name} · {cfg.workspace}
                        </span>
                      </span>
                      {active && <span className="flex-none font-sans text-[12px] text-plum">✓</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        )}

        {activeClient && (
          <span className="flex flex-none items-center gap-[7px] font-sans text-[13px] font-medium text-ink-400">
            <span className="text-ink-200">▸</span>
            {activeClient}
          </span>
        )}
        <span className="overflow-hidden text-ellipsis whitespace-nowrap font-sans text-[14.5px] font-semibold text-ink-900">
          {title}
        </span>
        {chatControls && (
          <span className="flex flex-none items-center gap-[5px] font-sans text-[11px] font-medium text-ink-300">
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: connected.length ? "#5E7B52" : "#C9A24A",
              }}
            />
            {channelSummary}
          </span>
        )}
      </div>
      {chatControls && (
      <div className="flex flex-none items-center gap-[10px]">
        <div className="flex gap-[2px] rounded-btn bg-line-seg p-[3px]">
          {TABS.map((t) => {
            const active = mode === t.mode;
            return (
              <button
                key={t.mode}
                type="button"
                onClick={() => onSetMode(t.mode)}
                className="cursor-pointer whitespace-nowrap rounded-chip font-sans text-[12px] font-semibold transition-all duration-150"
                style={{
                  padding: "6px 13px",
                  border: "none",
                  background: active ? "#2B2722" : "transparent",
                  color: active ? "#F2F1EC" : "#6B6359",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        {onModelChange && (
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            aria-label="Model"
            title="Choose the model for this conversation"
            className="cursor-pointer rounded-[9px] border border-line-1 bg-surface-chip font-sans text-[12px] font-semibold text-ink-700"
            style={{ padding: "7px 8px" }}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={onForecast}
          className="flex cursor-pointer items-center gap-[6px] rounded-[9px] border border-line-1 bg-surface-chip font-sans text-[12px] font-semibold text-ink-700"
          style={{ padding: "7px 12px" }}
        >
          ↗ Forecast
        </button>
        <button
          type="button"
          onClick={onReplay}
          className="flex cursor-pointer items-center gap-[6px] rounded-[9px] border border-plum-border bg-surface-chip font-sans text-[12px] font-semibold text-plum-deep"
          style={{ padding: "7px 12px" }}
        >
          ↻ Replay
        </button>
      </div>
      )}
    </header>
  );
}
