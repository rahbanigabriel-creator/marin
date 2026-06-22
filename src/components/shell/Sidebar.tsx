"use client";

import { useState } from "react";
import type { Channel, RecentChat } from "@/types/views";
import type { Account } from "@/lib/data/personas";

interface SidebarProps {
  activeChat: number;
  onSelectChat: (i: number) => void;
  recentChats: RecentChat[];
  channels: Channel[];
  account: Account;
  onNewChat: () => void;
  onStartPlan: () => void;
  onOpenModal: () => void;
  showClients: boolean;
  onViewClients: () => void;
  hideRecent?: boolean;
  primaryActionLabel?: string;
}

export function Sidebar({
  activeChat,
  onSelectChat,
  recentChats,
  channels,
  account,
  onNewChat,
  onStartPlan,
  onOpenModal,
  showClients,
  onViewClients,
  hideRecent = false,
  primaryActionLabel = "New plan",
}: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

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
          Marpin
        </span>
        <span
          className="rounded-[5px] font-mono text-[9.5px] font-semibold tracking-[0.04em]"
          style={{ color: "#B23A4B", background: "#F5E0E3", padding: "2px 6px" }}
        >
          BETA
        </span>
      </div>

      {/* new conversation + plan */}
      <button
        type="button"
        onClick={onNewChat}
        className="mb-[8px] flex w-full items-center gap-[9px] rounded-btn border border-line-1 bg-surface-chip font-sans text-[13px] font-semibold text-ink-900"
        style={{ padding: "10px 12px", cursor: "pointer" }}
      >
        <span className="text-[16px] leading-none text-plum">＋</span> New conversation
      </button>
      {showClients ? (
        <button
          type="button"
          onClick={onViewClients}
          className="mb-[18px] flex w-full items-center gap-[9px] rounded-btn font-sans text-[13px] font-semibold text-white"
          style={{ padding: "10px 12px", cursor: "pointer", border: "none", background: "#9A3D63" }}
        >
          <span className="text-[14px] leading-none">⊞</span> Clients
        </button>
      ) : (
        <button
          type="button"
          onClick={onStartPlan}
          className="mb-[18px] flex w-full items-center gap-[9px] rounded-btn font-sans text-[13px] font-semibold text-white"
          style={{ padding: "10px 12px", cursor: "pointer", border: "none", background: "#9A3D63" }}
        >
          <span className="text-[15px] leading-none">＋</span> {primaryActionLabel}
        </button>
      )}

      {/* scroll area */}
      <div className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto">
        {!hideRecent && (
          <>
            <div className="p-[6px_8px_5px] font-mono text-[10.5px] font-semibold tracking-[0.08em] text-ink-200">
              RECENT
            </div>
            {recentChats.map((chat, i) => (
              <div
                key={chat.title}
                onClick={() => onSelectChat(i)}
                className="cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap rounded-chip p-[8px_10px] font-sans text-[13px]"
                style={
                  i === activeChat
                    ? { background: "#F9F9F4", color: "#2B2722", fontWeight: 600 }
                    : { color: "#5A544A", fontWeight: 500 }
                }
              >
                {chat.title}
              </div>
            ))}
          </>
        )}

        <div className="p-[16px_8px_5px] font-mono text-[10.5px] font-semibold tracking-[0.08em] text-ink-200">
          CHANNELS
        </div>
        {channels.map((ch) => {
          const on = ch.status === "connected";
          return (
            <div
              key={ch.name}
              onClick={onOpenModal}
              className="flex cursor-pointer items-center gap-[9px] rounded-chip p-[7px_8px]"
            >
              <span
                className="flex-none"
                style={{ width: 8, height: 8, borderRadius: "50%", background: on ? "#5E7B52" : "#C9A24A" }}
              />
              <span className="flex-1 font-sans text-[13px] font-medium text-ink-800">{ch.name}</span>
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
      <div className="relative mt-[8px] border-t border-line-1">
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="animate-fadeUpFast absolute bottom-full left-0 right-0 z-50 mb-[6px] overflow-hidden rounded-btn border border-line-1 bg-surface-card shadow-modal">
              <div className="border-b border-line-3 p-[10px_12px]">
                <div className="font-sans text-[12.5px] font-semibold text-ink-900">{account.name}</div>
                <div className="font-sans text-[11px] text-ink-300">{account.sub}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenModal();
                }}
                className="block w-full cursor-pointer border-none bg-transparent p-[9px_12px] text-left font-sans text-[12.5px] font-medium text-ink-800 hover:bg-surface-chip"
              >
                Manage connections
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onNewChat();
                }}
                className="block w-full cursor-pointer border-none bg-transparent p-[9px_12px] text-left font-sans text-[12.5px] font-medium text-ink-800 hover:bg-surface-chip"
              >
                New conversation
              </button>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="block w-full cursor-pointer border-t border-line-3 bg-transparent p-[9px_12px] text-left font-sans text-[12.5px] font-medium text-plum-deep hover:bg-surface-chip"
              >
                Sign out
              </button>
            </div>
          </>
        )}
        <div className="flex items-center gap-[10px] p-[10px_8px]">
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
            {account.initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-sans text-[12.5px] font-semibold text-ink-900">{account.name}</div>
            <div className="font-sans text-[11px] text-ink-300">{account.sub}</div>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Account menu"
            aria-expanded={menuOpen}
            className="cursor-pointer border-none text-[15px] leading-none text-ink-200 hover:text-ink-400"
            style={{ background: menuOpen ? "#EFEEE7" : "transparent", borderRadius: 7, padding: "3px 5px" }}
          >
            ⚙
          </button>
        </div>
      </div>
    </aside>
  );
}
