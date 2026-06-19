"use client";

import type { Channel } from "@/types/views";
import { RECENT_CHATS } from "@/lib/data/canonical";

interface SidebarProps {
  activeChat: number;
  onSelectChat: (i: number) => void;
  channels: Channel[];
  onNewChat: () => void;
  onOpenModal: () => void;
  onChannelClick: (channel: Channel) => void;
}

export function Sidebar({
  activeChat,
  onSelectChat,
  channels,
  onNewChat,
  onOpenModal,
  onChannelClick,
}: SidebarProps) {
  return (
    <aside className="flex w-sidebar flex-none flex-col border-r border-line-1 bg-surface-sidebar p-[16px_12px_12px]">
      {/* brand */}
      <div className="flex items-center gap-[9px] p-[4px_8px_16px]">
        <div
          className="flex items-center justify-center font-serif text-[16px] font-semibold"
          style={{ width: 28, height: 28, borderRadius: 8, background: "#9A3D63", color: "#FBF6EE" }}
        >
          m
        </div>
        <span className="font-serif text-[18px] font-semibold tracking-[-0.01em] text-ink-900">
          Marin
        </span>
        <span
          className="rounded-[5px] font-mono text-[9.5px] font-semibold tracking-[0.04em]"
          style={{ color: "#B23A4B", background: "#F5E0E3", padding: "2px 6px" }}
        >
          BETA
        </span>
      </div>

      {/* new conversation */}
      <button
        type="button"
        onClick={onNewChat}
        className="mb-[18px] flex w-full items-center gap-[9px] rounded-btn border border-line-1 bg-surface-chip font-sans text-[13px] font-semibold text-ink-900"
        style={{ padding: "10px 12px", cursor: "pointer" }}
      >
        <span className="text-[16px] leading-none text-plum">＋</span> New conversation
      </button>

      {/* scroll area */}
      <div className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto">
        <div className="p-[6px_8px_5px] font-mono text-[10.5px] font-semibold tracking-[0.08em] text-ink-200">
          RECENT
        </div>
        {RECENT_CHATS.map((title, i) => (
          <div
            key={title}
            onClick={() => onSelectChat(i)}
            className="cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap rounded-chip p-[8px_10px] font-sans text-[13px]"
            style={
              i === activeChat
                ? { background: "#F9F9F4", color: "#2B2722", fontWeight: 600 }
                : { color: "#5A544A", fontWeight: 500 }
            }
          >
            {title}
          </div>
        ))}

        <div className="p-[16px_8px_5px] font-mono text-[10.5px] font-semibold tracking-[0.08em] text-ink-200">
          CHANNELS
        </div>
        {channels.map((ch) => {
          const on = ch.status === "connected";
          return (
            <div
              key={ch.name}
              onClick={() => onChannelClick(ch)}
              className="flex cursor-pointer items-center gap-[9px] rounded-chip p-[7px_8px]"
            >
              <span
                className="flex-none"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: on ? "#5E7B52" : "#C9A24A",
                }}
              />
              <span className="flex-1 font-sans text-[13px] font-medium text-ink-800">
                {ch.name}
              </span>
              {!on && (
                <span
                  className="rounded-pill font-sans text-[10.5px] font-semibold"
                  style={{ color: "#8A4A66", background: "#F2E2EA", padding: "2px 8px" }}
                >
                  Connect
                </span>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={onOpenModal}
          className="cursor-pointer border-none bg-transparent p-[9px_8px_4px] text-left font-sans text-[12px] font-medium text-plum-muted2"
        >
          Manage connections →
        </button>
      </div>

      {/* account */}
      <div className="mt-[8px] flex items-center gap-[10px] border-t border-line-1 p-[10px_8px]">
        <div
          className="flex items-center justify-center font-sans text-[12px] font-semibold"
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#8A8B6F,#5E7B52)",
            color: "#FBF6EE",
          }}
        >
          AL
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-sans text-[12.5px] font-semibold text-ink-900">Alex Lemoine</div>
          <div className="font-sans text-[11px] text-ink-300">Northwind · Growth</div>
        </div>
        <span className="text-[15px] text-ink-200">⚙</span>
      </div>
    </aside>
  );
}
