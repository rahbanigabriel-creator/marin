"use client";

import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { useState } from "react";
import type { RecentChat } from "@/types/views";
import type { Account } from "@/lib/data/personas";
import type { ProductMode } from "@/lib/product/platforms";
import {
  LuChevronLeft,
  LuChevronRight,
  LuBot,
  LuChartNoAxesCombined,
  LuLeaf,
  LuMegaphone,
  LuMessageSquare,
  LuPlus,
  LuPlug,
  LuScanSearch,
  LuSettings,
  LuUsers,
} from "react-icons/lu";

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
  /** real-product: open the unified campaigns dashboard. */
  onViewDashboard?: () => void;
  onViewAssistant?: () => void;
  onViewOrganic?: () => void;
  onViewAnalytics?: () => void;
  onViewAgents?: () => void;
  onOpenWebsiteAudit?: () => void;
  activeArea?: ProductMode | "assistant" | "brand" | "analytics" | "agents";
  hideRecent?: boolean;
  primaryActionLabel?: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  authEnabled?: boolean;
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
  onViewDashboard,
  onViewAssistant,
  onViewOrganic,
  onViewAnalytics,
  onViewAgents,
  onOpenWebsiteAudit,
  activeArea = "assistant",
  hideRecent = false,
  primaryActionLabel = "New plan",
  collapsed,
  onToggleCollapsed,
  authEnabled = false,
}: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonBase =
    "mb-[8px] flex w-full items-center gap-[9px] rounded-btn font-sans text-[13px] font-semibold";
  const realProductNavigation = Boolean(
    onViewDashboard
      && onViewAssistant
      && onViewOrganic
      && onViewAnalytics
      && onViewAgents,
  );

  const navButton = (
    label: string,
    area: ProductMode | "assistant" | "brand" | "analytics" | "agents",
    onClick: (() => void) | undefined,
    icon: React.ReactNode,
  ) => (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-current={activeArea === area ? "page" : undefined}
      className={`${buttonBase} ${collapsed ? "justify-center" : ""}`}
      style={{
        padding: collapsed ? "10px 0" : "10px 12px",
        cursor: "pointer",
        border: "none",
        background: activeArea === area ? "#F2E2EA" : "transparent",
        color: activeArea === area ? "#8A3459" : "#4A443B",
      }}
    >
      <span className="flex h-[18px] w-[18px] items-center justify-center">{icon}</span>
      {!collapsed && <span>{label}</span>}
    </button>
  );

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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/marpin-logo.png"
          alt="Marpin"
          width={30}
          height={30}
          className="flex-none object-contain"
          style={{ width: 30, height: 30 }}
        />
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
          {collapsed ? <LuChevronRight aria-hidden /> : <LuChevronLeft aria-hidden />}
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
        <LuPlus className="text-[16px] text-plum" aria-hidden />
        {!collapsed && <span>New conversation</span>}
      </button>
      {realProductNavigation ? (
        <nav aria-label="Workspace" className="mb-[10px]">
          {navButton("Assistant", "assistant", onViewAssistant, <LuMessageSquare aria-hidden />)}
          {navButton("Organic + SEO", "organic", onViewOrganic, <LuLeaf aria-hidden />)}
          {navButton("Paid campaigns", "paid", onViewDashboard, <LuMegaphone aria-hidden />)}
          {navButton("Analytics", "analytics", onViewAnalytics, <LuChartNoAxesCombined aria-hidden />)}
          {navButton("Agent runs", "agents", onViewAgents, <LuBot aria-hidden />)}
          <button
            type="button"
            onClick={onOpenModal}
            title="Manage connections"
            className={`${buttonBase} ${collapsed ? "justify-center" : ""}`}
            style={{
              padding: collapsed ? "10px 0" : "10px 12px",
              cursor: "pointer",
              border: "none",
              background: "transparent",
              color: "#6C645A",
            }}
          >
            <LuPlug className="h-[18px] w-[18px]" aria-hidden />
            {!collapsed && <span>Manage connections</span>}
          </button>
        </nav>
      ) : showClients ? (
        <button
          type="button"
          onClick={onViewClients}
          title="Clients"
          className={`${buttonBase} text-white ${collapsed ? "justify-center" : ""}`}
          style={{ padding: collapsed ? "10px 0" : "10px 12px", cursor: "pointer", border: "none", background: "#9A3D63" }}
        >
          <LuUsers className="text-[15px]" aria-hidden />
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
          <LuLeaf className="text-[15px]" aria-hidden />
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
              <button
                type="button"
                key={chat.id ?? `${i}-${chat.title}`}
                onClick={() => onSelectChat(i)}
                className="w-full cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap rounded-chip border-none p-[8px_10px] text-left font-sans text-[13px]"
                style={
                  i === activeChat
                    ? { background: "#F9F9F4", color: "#2B2722", fontWeight: 600 }
                    : { color: "#5A544A", fontWeight: 500 }
                }
              >
                {chat.title}
              </button>
            ))}
          </>
        )}

        {!collapsed && !realProductNavigation && (
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
            <div
              className={`animate-fadeUpFast absolute bottom-full left-0 z-50 mb-[6px] overflow-hidden rounded-btn border border-line-1 bg-surface-card shadow-modal ${
                collapsed ? "w-[220px]" : "right-0"
              }`}
            >
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
              {onOpenWebsiteAudit ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenWebsiteAudit();
                  }}
                  className="flex w-full cursor-pointer items-center gap-[7px] border-none bg-transparent p-[9px_12px] text-left font-sans text-[12.5px] font-medium text-ink-800 hover:bg-surface-chip"
                >
                  <LuScanSearch aria-hidden />
                  Website audit
                </button>
              ) : null}
              <Link
                href="/settings/billing"
                className="block w-full p-[9px_12px] text-left font-sans text-[12.5px] font-medium text-ink-800 no-underline hover:bg-surface-chip"
              >
                Billing &amp; usage
              </Link>
              <Link
                href="/settings/data"
                className="block w-full p-[9px_12px] text-left font-sans text-[12.5px] font-medium text-ink-800 no-underline hover:bg-surface-chip"
              >
                Data &amp; privacy
              </Link>
              {authEnabled ? (
                <SignOutButton redirectUrl="/">
                  <button
                    type="button"
                    onClick={() => setMenuOpen(false)}
                    className="block w-full cursor-pointer border-t border-line-3 bg-transparent p-[9px_12px] text-left font-sans text-[12.5px] font-medium text-plum-deep hover:bg-surface-chip"
                  >
                    Sign out
                  </button>
                </SignOutButton>
              ) : null}
            </div>
          </>
        )}
        <div className={`flex items-center gap-[10px] ${collapsed ? "justify-center p-[10px_0]" : "p-[10px_8px]"}`}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Account menu"
            aria-expanded={menuOpen}
            title="Account menu"
            className="flex h-[30px] w-[30px] flex-none cursor-pointer items-center justify-center rounded-full border-none p-0 font-sans text-[12px] font-semibold text-[#FBF6EE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
            style={{ background: "linear-gradient(135deg,#8A8B6F,#5E7B52)" }}
          >
            {account.initials}
          </button>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <div className="font-sans text-[12.5px] font-semibold text-ink-900">{account.name}</div>
                <div className="font-sans text-[11px] text-ink-300">{account.sub}</div>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Account settings"
                aria-expanded={menuOpen}
                className="cursor-pointer border-none text-[15px] leading-none text-ink-200 hover:text-ink-400"
                style={{ background: menuOpen ? "#EFEEE7" : "transparent", borderRadius: 7, padding: "3px 5px" }}
              >
                <LuSettings aria-hidden />
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
