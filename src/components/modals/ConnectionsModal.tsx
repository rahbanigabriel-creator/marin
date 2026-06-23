"use client";

import type { Channel } from "@/types/views";
import { PLATFORM_ICON_COLORS } from "@/lib/data/canonical";

interface ConnectionsModalProps {
  channels: Channel[];
  onClose: () => void;
  onConnect: (channel: Channel) => void;
}

function initialFor(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ConnectionsModal({ channels, onClose, onConnect }: ConnectionsModalProps) {
  return (
    <div
      onClick={onClose}
      className="animate-fadeUpFast fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(43,39,34,0.32)", backdropFilter: "blur(2px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[86vh] w-[560px] max-w-[92vw] overflow-y-auto rounded-modal border border-line-1 bg-surface-panel p-[24px] shadow-modal"
      >
        <div className="mb-[4px] flex items-start justify-between">
          <div className="font-serif text-[19px] font-semibold text-ink-900">Connect your data</div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer border-none bg-transparent text-[20px] leading-none text-ink-200"
          >
            ×
          </button>
        </div>
        <div className="mb-[20px] font-sans text-[13px] text-ink-400">
          Marpin reads live metrics and can push changes back to connected platforms.
        </div>
        {(["paid", "organic"] as const).map((cat) => {
          const group = channels.filter((ch) => (ch.category ?? "paid") === cat);
          if (group.length === 0) return null;
          return (
            <div key={cat} className="mb-[16px]">
              <div className="mb-[9px] font-mono text-[10.5px] font-semibold tracking-[0.08em] text-ink-200">
                {cat === "paid" ? "PAID ADS" : "ORGANIC & SEO"}
              </div>
              <div className="grid grid-cols-2 gap-[11px]">
                {group.map((c) => {
                  const on = c.status === "connected";
                  const errored = c.status === "error";
                  return (
                    <div
                      key={c.name}
                      className="flex items-center gap-[12px] rounded-[12px] border border-line-3 bg-surface-card p-[13px_14px]"
                    >
                      <div
                        className="flex flex-none items-center justify-center font-sans text-[13px] font-semibold text-white"
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 9,
                          background: PLATFORM_ICON_COLORS[c.name] ?? "#857B6D",
                        }}
                      >
                        {initialFor(c.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-sans text-[13.5px] font-semibold text-ink-900">{c.name}</div>
                        <div
                          className="mt-[2px] font-sans text-[11px] font-medium"
                          style={{ color: on ? "#5E7B52" : errored ? "#B23A4B" : "#A89D8B" }}
                        >
                          {on
                            ? c.displayName ?? "Connected · syncing"
                            : errored
                              ? "Connection needs attention"
                              : "Not connected"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onConnect(c)}
                        disabled={!c.platform}
                        className="flex-none cursor-pointer rounded-chip font-sans text-[12px] font-semibold"
                        style={
                          on
                            ? {
                                border: "1px solid #DDDBD2",
                                background: "transparent",
                                color: "#8A8072",
                                padding: "6px 12px",
                              }
                            : {
                                border: "none",
                                background: "#9A3D63",
                                color: "#fff",
                                padding: "6px 13px",
                              }
                        }
                      >
                        {on ? "Reconnect" : "Connect"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="mt-[20px] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-btn font-sans text-[13px] font-semibold text-white"
            style={{ border: "none", background: "#2B2722", padding: "10px 20px" }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
