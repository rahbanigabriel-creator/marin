"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  SiFacebook,
  SiGoogleads,
  SiGoogleanalytics,
  SiGooglesearchconsole,
  SiInstagram,
  SiMeta,
  SiPinterest,
  SiReddit,
  SiSnapchat,
  SiTiktok,
  SiYoutube,
} from "react-icons/si";
import { LuRefreshCw, LuUnplug, LuX } from "react-icons/lu";

import type { Channel, ConnectionDisconnectResult } from "@/types/views";

interface ConnectionsModalProps {
  channels: Channel[];
  connectedCount: number;
  maxConnections?: number;
  planName?: string;
  onClose: () => void;
  onConnect: (channel: Channel) => void;
  onDisconnect: (channel: Channel) => Promise<ConnectionDisconnectResult>;
  canManage?: boolean;
}

const ICONS: Record<string, IconType> = {
  google_ads: SiGoogleads,
  meta_ads: SiMeta,
  tiktok_ads: SiTiktok,
  youtube: SiYoutube,
  instagram: SiInstagram,
  facebook: SiFacebook,
  tiktok: SiTiktok,
  snapchat: SiSnapchat,
  reddit: SiReddit,
  pinterest: SiPinterest,
  ga4: SiGoogleanalytics,
  search_console: SiGooglesearchconsole,
};

const ICON_COLORS: Record<string, string> = {
  google_ads: "#4285F4",
  meta_ads: "#0866FF",
  tiktok_ads: "#111111",
  youtube: "#FF0033",
  instagram: "#C13584",
  facebook: "#0866FF",
  tiktok: "#111111",
  snapchat: "#E2BD00",
  reddit: "#FF4500",
  pinterest: "#BD081C",
  ga4: "#E37400",
  search_console: "#4285F4",
};

const SECTIONS = [
  { id: "measurement", label: "MEASUREMENT & SEO" },
  { id: "organic", label: "ORGANIC PUBLISHING" },
  { id: "paid", label: "PAID CAMPAIGNS" },
] as const;

function connectionStatus(channel: Channel): string {
  if (channel.status === "connected") return channel.displayName ? `Connected - ${channel.displayName}` : "Connected";
  if (channel.status === "error") return "Connection needs attention";
  if (channel.connectionAvailability === "planned") return "Publishing connection planned";
  if (channel.configured) return "Ready to connect";
  return "Developer app setup needed";
}

export function ConnectionsModal({
  channels,
  connectedCount,
  maxConnections,
  planName,
  onClose,
  onConnect,
  onDisconnect,
  canManage = true,
}: ConnectionsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmationCancelRef = useRef<HTMLButtonElement>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "warning" | "error";
    message: string;
  } | null>(null);
  const limitKnown = typeof maxConnections === "number";
  const limitReached = limitKnown && connectedCount >= maxConnections;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (confirmingId) confirmationCancelRef.current?.focus();
  }, [confirmingId]);

  const confirmDisconnect = async (channel: Channel) => {
    if (!channel.connectionId || busyId) return;
    setBusyId(channel.connectionId);
    setFeedback(null);
    try {
      const result = await onDisconnect(channel);
      setFeedback({
        tone: result.providerRevocation === "confirmed" ? "success" : "warning",
        message: result.message,
      });
      setConfirmingId(null);
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Marpin could not disconnect this account.",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="animate-fadeUpFast fixed inset-0 z-50 flex items-center justify-center p-[16px]"
      style={{ background: "rgba(43,39,34,0.32)", backdropFilter: "blur(2px)" }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connections-title"
        tabIndex={-1}
        className="max-h-[88vh] w-[720px] max-w-full overflow-y-auto rounded-[8px] border border-line-1 bg-surface-panel p-[20px] shadow-modal outline-none sm:p-[24px]"
      >
        <div className="mb-[4px] flex items-start justify-between gap-[16px]">
          <div>
            <h2 id="connections-title" className="m-0 font-serif text-[20px] font-semibold text-ink-900">
              Manage connections
            </h2>
            <p className="mb-[20px] mt-[5px] font-sans text-[13px] leading-[1.5] text-ink-400">
              Data access and publishing access are tracked separately so every action stays truthful.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close connections"
            title="Close"
            className="flex h-[32px] w-[32px] flex-none cursor-pointer items-center justify-center rounded-[8px] border border-line-2 bg-surface-chip text-[18px] text-ink-400"
          >
            <LuX aria-hidden />
          </button>
        </div>

        {limitKnown ? (
          <div
            className={`mb-[18px] flex flex-wrap items-center justify-between gap-[10px] rounded-[8px] border px-[12px] py-[10px] ${
              limitReached
                ? "border-plum-border bg-plum-soft"
                : "border-line-3 bg-surface-card"
            }`}
          >
            <div className="min-w-0">
              <p className="m-0 font-sans text-[12.5px] font-semibold text-ink-800">
                {connectedCount} of {maxConnections} connections used
              </p>
              <p className="mb-0 mt-[2px] font-sans text-[11.5px] text-ink-400">
                {planName ?? "Current plan"}
                {limitReached ? " has reached its connection limit." : " connection allowance."}
              </p>
            </div>
            {limitReached ? (
              <Link
                href="/settings/billing"
                className="rounded-[7px] bg-plum px-[11px] py-[7px] font-sans text-[11.5px] font-semibold text-white no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
              >
                View plans
              </Link>
            ) : null}
          </div>
        ) : null}

        <div aria-live="polite" aria-atomic="true">
          {!canManage ? (
            <div role="status" className="mb-[16px] border-l-[3px] border-line-1 bg-surface-card px-[11px] py-[9px] font-sans text-[12px] leading-[1.45] text-ink-600">
              Read-only access. An owner or admin manages workspace connections.
            </div>
          ) : null}
          {feedback ? (
            <div
              role={feedback.tone === "error" ? "alert" : "status"}
              className={`mb-[16px] border-l-[3px] px-[11px] py-[9px] font-sans text-[12px] leading-[1.45] ${
                feedback.tone === "success"
                  ? "border-pos-700 bg-pos-bg text-pos-700"
                  : feedback.tone === "warning"
                    ? "border-plum bg-plum-soft text-ink-700"
                    : "border-neg-700 bg-neg-bg text-neg-700"
              }`}
            >
              {feedback.message}
            </div>
          ) : null}
        </div>

        {SECTIONS.map((section) => {
          const group = channels.filter((channel) => channel.category === section.id);
          if (group.length === 0) return null;
          return (
            <section key={section.id} className="mb-[18px]" aria-labelledby={`connections-${section.id}`}>
              <h3
                id={`connections-${section.id}`}
                className="mb-[9px] mt-0 font-mono text-[10.5px] font-semibold tracking-[0.08em] text-ink-300"
              >
                {section.label}
              </h3>
              <div className="grid grid-cols-1 gap-[9px] sm:grid-cols-2">
                {group.map((channel) => {
                  const on = channel.status === "connected";
                  const errored = channel.status === "error";
                  const planned = channel.connectionAvailability === "planned";
                  const existingConnection = on || errored;
                  const availableConnector = Boolean(channel.connectorPlatform && channel.configured);
                  const blockedByLimit = limitReached && !existingConnection && availableConnector;
                  const canConnect = canManage && availableConnector && !blockedByLimit;
                  const Icon = channel.platform ? ICONS[channel.platform] : undefined;
                  const rowKey = channel.connectionId ?? channel.platform ?? channel.name;
                  const confirming = Boolean(channel.connectionId && confirmingId === channel.connectionId);
                  const busy = Boolean(channel.connectionId && busyId === channel.connectionId);
                  const accountMeta = [
                    channel.externalAccountId ? `ID ${channel.externalAccountId}` : null,
                    channel.currency ?? null,
                    channel.timezone ?? null,
                  ].filter((value): value is string => Boolean(value));
                  return (
                    <div
                      key={rowKey}
                      aria-busy={busy || undefined}
                      className="min-w-0 rounded-[8px] border border-line-3 bg-surface-card p-[12px]"
                    >
                      <div className="flex min-h-[66px] min-w-0 flex-wrap items-center gap-[10px]">
                        <div className="flex h-[36px] w-[36px] flex-none items-center justify-center rounded-[8px] border border-line-4 bg-surface-chip">
                          {Icon ? (
                            <Icon
                              size={19}
                              color={ICON_COLORS[channel.platform ?? ""] ?? "#6F675C"}
                              aria-hidden
                            />
                          ) : null}
                        </div>
                        <div className="min-w-[120px] flex-1">
                          <div className="font-sans text-[13.5px] font-semibold text-ink-900">{channel.name}</div>
                          <div
                            className="mt-[2px] overflow-hidden text-ellipsis font-sans text-[11px] font-medium leading-[1.35]"
                            style={{ color: on ? "#5E7B52" : errored ? "#B23A4B" : "#8C8274" }}
                          >
                            {blockedByLimit ? "Upgrade to connect another account" : connectionStatus(channel)}
                          </div>
                          {accountMeta.length > 0 ? (
                            <div
                              className="mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[9.5px] text-ink-300"
                              title={accountMeta.join(" | ")}
                            >
                              {accountMeta.join(" | ")}
                            </div>
                          ) : null}
                        </div>
                        <div className="ml-auto flex flex-none flex-wrap items-center justify-end gap-[6px]">
                          <button
                            type="button"
                            onClick={() => onConnect(channel)}
                            disabled={!canConnect || busy}
                            className="min-w-[72px] flex-none cursor-pointer rounded-[8px] px-[9px] py-[6px] font-sans text-[11.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-55"
                            style={
                              existingConnection
                                ? { border: "1px solid #DDDBD2", background: "transparent", color: "#746B5F" }
                                : canConnect
                                  ? { border: "none", background: "#9A3D63", color: "#fff" }
                                  : { border: "1px solid #E2DED5", background: "#F4F2ED", color: "#9A9185" }
                            }
                          >
                            {!canManage
                              ? "Read only"
                              : on || errored
                              ? "Reconnect"
                              : blockedByLimit
                                ? "Limit reached"
                                : planned
                                  ? "Planned"
                                  : canConnect
                                    ? "Connect"
                                    : "Setup"}
                          </button>
                          {canManage && existingConnection && channel.connectionId ? (
                            <button
                              type="button"
                              onClick={() => {
                                setFeedback(null);
                                setConfirmingId(channel.connectionId ?? null);
                              }}
                              disabled={busy}
                              aria-label={`Disconnect ${channel.displayName ?? channel.name}`}
                              title="Disconnect account"
                              className="flex h-[29px] w-[29px] flex-none cursor-pointer items-center justify-center rounded-[7px] border border-line-2 bg-transparent text-neg-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {busy ? (
                                <LuRefreshCw aria-hidden className="animate-spin motion-reduce:animate-none" />
                              ) : (
                                <LuUnplug aria-hidden />
                              )}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {confirming ? (
                        <div className="mt-[9px] border-t border-line-3 pt-[10px]">
                          <p
                            id={`disconnect-${channel.connectionId}-description`}
                            className="m-0 font-sans text-[11.5px] leading-[1.45] text-ink-600"
                          >
                            Remove this account and its synced data from Marpin? Marpin will request provider revocation when supported and report whether it was confirmed.
                          </p>
                          <div className="mt-[9px] flex flex-wrap justify-end gap-[7px]">
                            <button
                              ref={confirmationCancelRef}
                              type="button"
                              onClick={() => setConfirmingId(null)}
                              disabled={busy}
                              className="h-[30px] cursor-pointer rounded-[7px] border border-line-2 bg-transparent px-[10px] font-sans text-[11px] font-semibold text-ink-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void confirmDisconnect(channel)}
                              disabled={busy}
                              aria-describedby={`disconnect-${channel.connectionId}-description`}
                              className="flex h-[30px] cursor-pointer items-center gap-[6px] rounded-[7px] border-none bg-neg-700 px-[10px] font-sans text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {busy ? (
                                <LuRefreshCw aria-hidden className="animate-spin motion-reduce:animate-none" />
                              ) : (
                                <LuUnplug aria-hidden />
                              )}
                              {busy ? "Disconnecting" : "Disconnect"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        <div className="mt-[4px] flex justify-end border-t border-line-3 pt-[16px]">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-[8px] border-none bg-ink-900 px-[18px] py-[9px] font-sans text-[13px] font-semibold text-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
