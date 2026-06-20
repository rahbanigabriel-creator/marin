"use client";

import { useState } from "react";

interface ComposerProps {
  onSend: (text: string) => void;
  onSuggest: (text: string) => void;
  variant: "split" | "thread";
  suggestions: string[];
}

export function Composer({ onSend, onSuggest, variant, suggestions }: ComposerProps) {
  const [input, setInput] = useState("");

  function send() {
    const v = input.trim();
    if (!v) return;
    setInput("");
    onSend(v);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const chips = (
    <div className="mb-[10px] flex flex-wrap gap-[7px]">
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onSuggest(s)}
          className="cursor-pointer whitespace-nowrap rounded-[20px] border border-line-2 bg-surface-chip font-sans text-[12px] font-medium text-ink-500"
          style={{ padding: "6px 12px" }}
        >
          {s}
        </button>
      ))}
    </div>
  );

  if (variant === "thread") {
    return (
      <div>
        {chips}
        <div className="flex items-end gap-[10px] rounded-card border border-line-1 bg-surface-card p-[11px_14px] shadow-composer">
          <textarea
            rows={1}
            placeholder="Ask a follow-up…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            className="flex-1 resize-none border-none bg-transparent font-sans text-[15px] leading-[1.5] text-ink-900 outline-none"
          />
          <button
            type="button"
            onClick={send}
            className="flex-none cursor-pointer rounded-[9px] text-[16px] text-white"
            style={{ width: 34, height: 34, border: "none", background: "#9A3D63" }}
          >
            ↑
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-none border-t border-line-2 bg-surface-panel p-[12px_16px_14px]">
      {chips}
      <div className="rounded-input border border-line-1 bg-surface-card p-[10px_12px]">
        <textarea
          rows={2}
          placeholder="Ask about spend, ROAS, creative, attribution…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          className="w-full resize-none border-none bg-transparent font-sans text-[14px] leading-[1.5] text-ink-900 outline-none"
        />
        <div className="mt-[6px] flex items-center justify-between">
          <span className="font-mono text-[11px] font-medium text-ink-200">
            ⌘ 4 sources connected
          </span>
          <button
            type="button"
            onClick={send}
            className="flex items-center justify-center rounded-chip text-[15px] text-white"
            style={{ width: 30, height: 30, border: "none", background: "#9A3D63" }}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
