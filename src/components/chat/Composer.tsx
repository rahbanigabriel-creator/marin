"use client";

import { useState } from "react";
import { LuArrowUp, LuSquare } from "react-icons/lu";

import { LAUNCH_FEATURES } from "@/lib/product/features";

interface ComposerProps {
  onSend: (text: string) => void;
  onSuggest: (text: string) => void;
  variant: "split" | "thread";
  suggestions: string[];
  connectedCount: number;
  placeholder?: string;
  model?: string;
  onModelChange?: (model: string) => void;
  isStreaming?: boolean;
  onStop?: () => void;
  canUseOpus?: boolean;
  readOnly?: boolean;
}

export function Composer({
  onSend,
  onSuggest,
  variant,
  suggestions,
  connectedCount,
  placeholder,
  model = "auto",
  onModelChange,
  isStreaming = false,
  onStop,
  canUseOpus = false,
  readOnly = false,
}: ComposerProps) {
  const [input, setInput] = useState("");
  const opusAvailable = LAUNCH_FEATURES.opusResponses && canUseOpus;

  function send() {
    const v = input.trim();
    if (!v || readOnly) return;
    setInput("");
    onSend(v);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (readOnly) return;
      if (isStreaming) onStop?.();
      else send();
    }
  }

  const chips = (
    <div className="mb-[10px] flex flex-wrap gap-[7px]">
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onSuggest(s)}
          disabled={readOnly}
          className="cursor-pointer whitespace-nowrap rounded-[20px] border border-line-2 bg-surface-chip font-sans text-[12px] font-medium text-ink-500 disabled:cursor-not-allowed disabled:opacity-50"
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
      disabled={readOnly}
      aria-label="Model"
      title="Choose response depth"
      className="h-[30px] max-w-[174px] cursor-pointer rounded-[9px] border border-line-2 bg-surface-chip px-[8px] font-sans text-[11.5px] font-semibold text-ink-600 outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      {[
        { id: "auto", label: "Auto" },
        { id: "claude-sonnet-4-6", label: "High (Claude Sonnet)" },
        {
          id: "claude-opus-4-8",
          label: !LAUNCH_FEATURES.opusResponses
            ? "Extra (Opus 4.8) · Soon"
            : canUseOpus
              ? "Extra (Opus 4.8)"
              : "Extra (Opus 4.8) · Solo",
          disabled: !opusAvailable,
        },
      ].map((option) => (
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
        <div className="flex flex-col gap-[10px] rounded-[8px] border border-line-1 bg-surface-card p-[11px_14px] shadow-composer sm:flex-row sm:items-end">
          <textarea
            rows={1}
            placeholder={readOnly ? "Read-only workspace" : placeholder ?? "Ask a follow-up…"}
            disabled={readOnly}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            className="min-w-0 w-full flex-1 resize-none border-none bg-transparent font-sans text-[15px] leading-[1.5] text-ink-900 outline-none disabled:cursor-not-allowed disabled:text-ink-400"
          />
          <div className="flex items-center justify-end gap-[8px]">
            {modelPicker}
            <button
              type="button"
              onClick={isStreaming ? onStop : send}
              disabled={readOnly || (!isStreaming && input.trim().length === 0)}
              aria-label={isStreaming ? "Stop response" : "Send message"}
              data-testid="chat-submit"
              title={isStreaming ? "Stop" : "Send"}
              className="flex flex-none cursor-pointer items-center justify-center rounded-[8px] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
              style={{ width: 34, height: 34, border: "none", background: "#9A3D63" }}
            >
              {isStreaming ? <LuSquare size={13} aria-hidden /> : <LuArrowUp size={17} aria-hidden />}
            </button>
          </div>
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
          placeholder={readOnly ? "Read-only workspace" : placeholder ?? "Ask anything — strategy, competitors, campaigns, SEO, your website…"}
          disabled={readOnly}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          className="w-full resize-none border-none bg-transparent font-sans text-[14px] leading-[1.5] text-ink-900 outline-none disabled:cursor-not-allowed disabled:text-ink-400"
        />
        <div className="mt-[6px] flex flex-wrap items-center justify-end gap-[8px] sm:justify-between">
          <span className="hidden font-mono text-[11px] font-medium text-ink-200 sm:inline">
            {connectedCount === 0
              ? "No sources connected"
              : `${connectedCount} source${connectedCount === 1 ? "" : "s"} connected`}
          </span>
          <div className="flex items-center gap-[8px]">
            {modelPicker}
            <button
              type="button"
              onClick={isStreaming ? onStop : send}
              disabled={readOnly || (!isStreaming && input.trim().length === 0)}
              aria-label={isStreaming ? "Stop response" : "Send message"}
              data-testid="chat-submit"
              title={isStreaming ? "Stop" : "Send"}
              className="flex cursor-pointer items-center justify-center rounded-chip text-[15px] text-white disabled:cursor-not-allowed disabled:opacity-50"
              style={{ width: 30, height: 30, border: "none", background: "#9A3D63" }}
            >
              {isStreaming ? <LuSquare size={12} aria-hidden /> : <LuArrowUp size={16} aria-hidden />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
