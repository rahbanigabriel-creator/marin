"use client";

import type { Channel, Mode } from "@/types/views";

interface TopBarProps {
  mode: Mode;
  onSetMode: (mode: Mode) => void;
  onReplay: () => void;
  /** active conversation title */
  title: string;
  channels: Channel[];
}

const TABS: Array<{ mode: Mode; label: string }> = [
  { mode: "split", label: "Split canvas" },
  { mode: "thread", label: "Thread" },
  { mode: "report", label: "Report" },
];

export function TopBar({ mode, onSetMode, onReplay, title, channels }: TopBarProps) {
  const connected = channels.filter((c) => c.status === "connected").map((c) => c.name);
  const channelSummary =
    connected.length === 0
      ? "No channels connected"
      : connected.slice(0, 3).join(" · ") +
        (connected.length > 3 ? ` +${connected.length - 3}` : "");

  return (
    <header className="flex h-topbar flex-none items-center justify-between gap-[16px] border-b border-line-2 bg-surface-panel px-[20px]">
      <div className="flex min-w-0 items-center gap-[12px]">
        <span className="overflow-hidden text-ellipsis whitespace-nowrap font-sans text-[14.5px] font-semibold text-ink-900">
          {title}
        </span>
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
      </div>
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
        <button
          type="button"
          onClick={onReplay}
          className="flex cursor-pointer items-center gap-[6px] rounded-[9px] border border-plum-border bg-surface-chip font-sans text-[12px] font-semibold text-plum-deep"
          style={{ padding: "7px 12px" }}
        >
          ↻ Replay
        </button>
      </div>
    </header>
  );
}
