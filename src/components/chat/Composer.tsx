"use client";

import { useState } from "react";

interface ComposerProps {
  onSend: (text: string) => void;
  onSuggest: (text: string) => void;
  variant: "split" | "thread";
  suggestions: string[];
  connectedCount: number;
  placeholder?: string;
  model?: string;
  onModelChange?: (model: string) => void;
}

const MODEL_OPTIONS: Array<{ id: string; label: string; disabled?: boolean }> = [
  { id: "auto", label: "Auto" },
  { id: "claude-sonnet-4-6", label: "High (Claude Sonnet)" },
  { id: "opus-disabled", label: "Extra (Opus 4.8) · Paid", disabled: true },
];

export function Composer({
  onSend,
  onSuggest,
  variant,
  suggestions,
  connectedCount,
  placeholder,
  model = "auto",
  onModelChange,
}: ComposerProps) {
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
  const modelPicker = onModelChange ? (
    <select
      value={model}
      onChange={(e) => onModelChange(e.target.value)}
      aria-label="Model"
      title="Choose response depth"
      className="h-[30px] max-w-[174px] cursor-pointer rounded-[9px] border border-line-2 bg-surface-chip px-[8px] font-sans text-[11.5px] font-semibold text-ink-600 outline-none"
    >
      {MODEL_OPTIONS.map((option) => (
        <option key={option.id} value={option.id} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  ) : null;

  if (variant === "thread") {
    return (
      <div>
        {chips}
        <div className="flex items-end gap-[10px] rounded-card border border-line-1 bg-surface-card p-[11px_14px] shadow-composer">
          <textarea
            rows={1}
            placeholder={placeholder ?? "Ask a follow-up…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            className="flex-1 resize-none border-none bg-transparent font-sans text-[15px] leading-[1.5] text-ink-900 outline-none"
          />
          {modelPicker}
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
          placeholder={placeholder ?? "Ask anything — strategy, competitors, campaigns, SEO, your website…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          className="w-full resize-none border-none bg-transparent font-sans text-[14px] leading-[1.5] text-ink-900 outline-none"
        />
        <div className="mt-[6px] flex items-center justify-between">
          <span className="font-mono text-[11px] font-medium text-ink-200">
            {connectedCount === 0
              ? "No sources connected"
              : `${connectedCount} source${connectedCount === 1 ? "" : "s"} connected`}
          </span>
          <div className="flex items-center gap-[8px]">
            {modelPicker}
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
    </div>
  );
}
