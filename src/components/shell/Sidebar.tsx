"use client";

import { useState } from "react";
import type { RecentChat } from "@/types/views";
import type { Account } from "@/lib/data/personas";

interface SidebarProps {
  activeChat: number;
  onSelectChat: (i: number) => void;
  recentChats: RecentChat[];
  account: Account;
  onNewChat: () => void;
  onStartPlan: () => void;
  onOpenModal: () => void;
  showClients: boolean;
  onViewClients: () => void;
  hideRecent?: boolean;
  primaryActionLabel?: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function Sidebar({
  activeChat,
  onSelectChat,
  recentChats,
  account,
  onNewChat,
  onStartPlan,
  onOpenModal,
  showClients,
  onViewClients,
  hideRecent = false,
  primaryActionLabel = "New plan",
  collapsed,
  onToggleCollapsed,
}: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonBase =
    "mb-[8px] flex w-full items-center gap-[9px] rounded-btn font-sans text-[13px] font-semibold";
  const primaryIsConnections = primaryActionLabel.toLowerCase().includes("connection");

  return (
    <aside
      className={`flex flex-none flex-col border-r border-line-1 bg-surface-sidebar transition-[width] duration-200 ${
        collapsed ? "w-[64px] p-[12px_8px]" : "w-sidebar p-[16px_12px_12px]"
      }`}
    >
      {/* brand */}
      <div
        className={`flex items-center gap-[9px] ${
          collapsed ? "flex-col justify-center p-[4px_0_14px]" : "p-[4px_8px_16px]"
        }`}
      >
        <div
          className="flex items-center justify-center font-serif text-[16px] font-semibold"
          style={{ width: 28, height: 28, borderRadius: 8, background: "#9A3D63", color: "#FBF6EE" }}
        >
          m
        </div>
        {!collapsed && (
          <>
            <span className="font-serif text-[18px] font-semibold tracking-[0] text-ink-900">
              Marpin
            </span>
            <span
              className="rounded-[5px] font-mono text-[9.5px] font-semibold tracking-[0.04em]"
              style={{ color: "#B23A4B", background: "#F5E0E3", padding: "2px 6px" }}
            >
              BETA
            </span>
          </>
        )}
        {!collapsed && <div className="flex-1" />}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex cursor-pointer items-center justify-center rounded-[8px] border border-line-2 bg-surface-chip font-sans text-[13px] font-semibold text-ink-500"
          style={{ width: 28, height: 28 }}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      {/* new conversation + plan */}
      <button
        type="button"
        onClick={onNewChat}
        title="New conversation"
        className={`${buttonBase} border border-line-1 bg-surface-chip text-ink-900 ${collapsed ? "justify-center" : ""}`}
        style={{ padding: collapsed ? "10px 0" : "10px 12px", cursor: "pointer" }}
      >
        <span className="text-[16px] leading-none text-plum">＋</span>
        {!collapsed && <span>New conversation</span>}
      </button>
      {showClients ? (
        <button
          type="button"
          onClick={onViewClients}
          title="Clients"
          className={`${buttonBase} text-white ${collapsed ? "justify-center" : ""}`}
          style={{ padding: collapsed ? "10px 0" : "10px 12px", cursor: "pointer", border: "none", background: "#9A3D63" }}
        >
          <span className="text-[14px] leading-none">⊞</span>
          {!collapsed && <span>Clients</span>}
        </button>
      ) : (
        <button
          type="button"
          onClick={onStartPlan}
          title={primaryActionLabel}
          className={`${buttonBase} mb-[18px] text-white ${collapsed ? "justify-center" : ""}`}
          style={{ padding: collapsed ? "10px 0" : "10px 12px", cursor: "pointer", border: "none", background: "#9A3D63" }}
        >
          <span className="text-[15px] leading-none">⌁</span>
          {!collapsed && primaryActionLabel}
        </button>
      )}

      {/* scroll area */}
      <div className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto">
        {!hideRecent && !collapsed && (
          <>
            <div className="p-[6px_8px_5px] font-mono text-[10.5px] font-semibold tracking-[0.08em] text-ink-200">
              RECENT
            </div>
            {recentChats.map((chat, i) => (
              <div
                key={`${i}-${chat.title}`}
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

        {!collapsed && !primaryIsConnections && (
          <button
            type="button"
            onClick={onOpenModal}
            className="cursor-pointer border-none bg-transparent p-[14px_8px_4px] text-left font-sans text-[12px] font-medium text-plum-muted2"
          >
            Manage connections →
          </button>
        )}
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
        <div className={`flex items-center gap-[10px] ${collapsed ? "justify-center p-[10px_0]" : "p-[10px_8px]"}`}>
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
          {!collapsed && (
            <>
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
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
