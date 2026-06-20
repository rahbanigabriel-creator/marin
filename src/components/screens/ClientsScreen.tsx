"use client";

import type { ClientAccount } from "@/lib/data/clients";

function statusStyle(s: ClientAccount["status"]) {
  if (s === "healthy") return { dot: "#5E7B52", bg: "#E7EEE0", color: "#4C6B40", label: "Healthy" };
  if (s === "watch") return { dot: "#C9A24A", bg: "#F3ECDD", color: "#8A6D2A", label: "Watch" };
  return { dot: "#B23A4B", bg: "#F5E0E3", color: "#B23A4B", label: "Critical" };
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-sans text-[10.5px] font-medium text-ink-300">{label}</div>
      <div className="mt-[1px] font-mono text-[14px] font-semibold text-ink-900">{value}</div>
    </div>
  );
}

interface ClientsScreenProps {
  clients: ClientAccount[];
  workspace: string;
  onOpenClient: (c: ClientAccount) => void;
}

export function ClientsScreen({ clients, workspace, onOpenClient }: ClientsScreenProps) {
  const attention = clients.filter((c) => c.status !== "healthy");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface-page p-[28px_32px_40px]">
      <div className="mx-auto w-full max-w-[1000px]">
        <div className="mb-[20px]">
          <h1 className="m-0 font-serif text-[26px] font-medium tracking-[-0.01em] text-ink-900">
            {workspace} · Clients
          </h1>
          <div className="mt-[3px] font-sans text-[13px] text-ink-400">
            {clients.length} accounts ·{" "}
            <span style={{ color: attention.length ? "#B23A4B" : "#4C6B40", fontWeight: 600 }}>
              {attention.length} need attention
            </span>
          </div>
        </div>

        {attention.length > 0 && (
          <div className="mb-[22px] rounded-card border border-line-3 bg-surface-card p-[14px_16px]">
            <div className="mb-[10px] font-mono text-[10.5px] font-semibold tracking-[0.06em] text-ink-300">
              NEEDS ATTENTION TODAY
            </div>
            <div className="flex flex-col">
              {attention.map((c, i) => {
                const s = statusStyle(c.status);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onOpenClient(c)}
                    className="flex cursor-pointer items-center gap-[11px] border-none bg-transparent p-[9px_4px] text-left"
                    style={i === 0 ? undefined : { borderTop: "1px solid var(--border-4)" }}
                  >
                    <span className="flex-none" style={{ width: 9, height: 9, borderRadius: "50%", background: s.dot }} />
                    <span className="w-[150px] flex-none font-sans text-[13px] font-semibold text-ink-900">
                      {c.name}
                    </span>
                    <span className="min-w-0 flex-1 font-sans text-[12.5px] text-ink-450">{c.alert}</span>
                    <span className="flex-none font-sans text-[12px] font-semibold text-plum">Open →</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div
          className="grid gap-[12px]"
          style={{ gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))" }}
        >
          {clients.map((c) => {
            const s = statusStyle(c.status);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpenClient(c)}
                className="flex cursor-pointer flex-col gap-[12px] rounded-card border border-line-3 bg-surface-card p-[15px_16px] text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-[8px]">
                      <span className="flex-none" style={{ width: 8, height: 8, borderRadius: "50%", background: s.dot }} />
                      <span className="font-sans text-[14px] font-semibold text-ink-900">{c.name}</span>
                    </div>
                    <div className="mt-[2px] font-sans text-[12px] text-ink-300">{c.industry}</div>
                  </div>
                  <span
                    className="flex-none rounded-pill font-sans text-[10.5px] font-semibold"
                    style={{ background: s.bg, color: s.color, padding: "2px 8px" }}
                  >
                    {s.label}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-[8px]">
                  <KV label="Spend" value={c.spend} />
                  <KV label="ROAS" value={c.roas} />
                  <KV label="CPA" value={c.cpa} />
                </div>
                {c.alert && (
                  <div className="font-sans text-[12px] leading-[1.4]" style={{ color: s.color }}>
                    ⚠ {c.alert}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
