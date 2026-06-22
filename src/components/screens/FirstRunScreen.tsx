"use client";

import type { Channel } from "@/types/views";
import { PLATFORM_ICON_COLORS } from "@/lib/data/canonical";

interface FirstRunScreenProps {
  channels: Channel[];
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

export function FirstRunScreen({ channels, onConnect }: FirstRunScreenProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-page p-[28px]">
      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col justify-center">
        <div className="mb-[22px]">
          <div className="font-mono text-[11px] font-semibold tracking-[0.08em] text-plum-muted2">
            CONNECT DATA
          </div>
          <h1 className="m-0 mt-[7px] font-serif text-[30px] font-medium tracking-[0] text-ink-900">
            Connect your accounts to see your real data
          </h1>
          <p className="m-0 mt-[8px] max-w-[560px] font-sans text-[14px] leading-[1.65] text-ink-400">
            Marpin needs at least one connected marketing or analytics account before it can render
            your KPIs, charts, funnel, and agent answers.
          </p>
        </div>

        <div className="grid gap-[12px]" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))" }}>
          {channels.map((channel) => (
            <button
              key={channel.name}
              type="button"
              onClick={() => onConnect(channel)}
              disabled={!channel.platform}
              className="flex cursor-pointer items-center gap-[12px] rounded-[8px] border border-line-2 bg-surface-card p-[14px] text-left shadow-composer transition-all hover:border-plum-border"
            >
              <span
                className="flex flex-none items-center justify-center font-sans text-[12px] font-semibold text-white"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: PLATFORM_ICON_COLORS[channel.name] ?? "#857B6D",
                }}
              >
                {initialFor(channel.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-sans text-[13.5px] font-semibold text-ink-900">
                  {channel.name}
                </span>
                <span className="mt-[2px] block font-sans text-[11.5px] font-medium text-plum">
                  Connect account
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
