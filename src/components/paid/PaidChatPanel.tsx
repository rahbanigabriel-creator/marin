"use client";

import { useEffect, useRef } from "react";
import { LuArrowUpRight, LuPlus, LuX } from "react-icons/lu";
import type { SplitViewProps } from "@/components/views/SplitView";
import { PriorTurns } from "@/components/chat/PriorTurns";
import { UserBubble } from "@/components/chat/UserBubble";
import { AssistantBlock } from "@/components/chat/AssistantBlock";
import { ChoiceChips } from "@/components/chat/ChoiceChips";
import { Composer } from "@/components/chat/Composer";
import { AnswerCanvas } from "@/components/canvas/AnswerCanvas";

const iconButton = "flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-ink-400 hover:bg-surface-chip focus-visible:outline focus-visible:outline-2 focus-visible:outline-plum";

export function PaidChatPanel(props: SplitViewProps & {
  hasAsked: boolean;
  onClose: () => void;
  onNewChat: () => void;
  workspaceName: string;
  historyLoading: boolean;
  historyError: string | null;
  draftText: string;
  onDraftChange: (text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll && following.current) scroll.scrollTop = scroll.scrollHeight;
  }, [props.typed, props.turns, props.status, props.choices]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-surface-panel">
      <header className="flex h-[50px] shrink-0 items-center gap-2 border-b border-line-2 px-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marpin-logo.png" alt="" width={22} height={22} />
        <h2 id="paid-chat-title" className="min-w-0 flex-1 text-[13px] font-semibold text-ink-800">Campaign chat</h2>
        <button type="button" title="New conversation" aria-label="New campaign conversation" onClick={props.onNewChat} className={iconButton}><LuPlus aria-hidden /></button>
        <button type="button" title="Close chat" aria-label="Close campaign chat" onClick={props.onClose} className={iconButton}><LuX aria-hidden /></button>
      </header>
      {props.hasAsked && props.dataMode === "sample" ? <p role="status" className="border-b border-line-2 px-4 py-2 text-[12px] text-amber-800">Sample data. This saved analysis does not reflect your connected accounts.</p> : null}
      {props.historyLoading ? <p role="status" className="px-4 py-2 text-[12px] text-ink-400">Loading conversation...</p> : null}
      {props.historyError ? <p role="alert" className="border-b border-line-2 px-4 py-2 text-[12px] text-neg-700">{props.historyError}</p> : null}
      <div ref={scrollRef} onScroll={() => {
        const node = scrollRef.current;
        if (node) following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      }} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-4 [overflow-wrap:anywhere]">
        {props.hasAsked ? <>
          <PriorTurns turns={props.turns} variant="split" />
          <UserBubble text={props.question} variant="split" />
          <AssistantBlock step={props.step} typed={props.typed} status={props.status} done={props.done} lead={props.scenario.lead} chips={props.chips} closing={props.closing} variant="split" />
          {props.error ? <div role="alert" data-testid="chat-error" className="border-l-2 border-neg-700 pl-3 text-[12px] text-neg-700">
            <p>{props.error}</p>
            {props.errorAction ? <a href={props.errorAction.url} className="mt-2 inline-block font-semibold underline">{props.errorAction.label}</a> : <button type="button" disabled={props.readOnly} onClick={() => { if (!props.readOnly) props.onRetry(); }} className="mt-2 font-semibold underline disabled:opacity-50">Retry</button>}
          </div> : null}
          {props.choices ? <fieldset disabled={props.readOnly} className="min-w-0 border-0 p-0 disabled:opacity-50"><ChoiceChips questions={props.choices.questions} onChoose={(text) => { if (!props.readOnly) props.onChoose(text); }} /></fieldset> : null}
          {props.artifacts.length ? <details open className="min-w-0 border-t border-line-2 pt-3">
            <summary className="mb-3 cursor-pointer text-[12px] font-semibold text-ink-600">Campaign analysis</summary>
            <div className="min-w-0 overflow-x-auto"><AnswerCanvas step={props.step} artifacts={props.artifacts} channels={props.channels} onConnect={props.onConnect} /></div>
          </details> : null}
        </> : <div className="my-auto py-8">
          <p className="text-[11px] font-medium text-plum">{props.workspaceName}</p>
          <h3 className="mt-2 text-[20px] font-semibold leading-tight text-ink-900">What should we work on?</h3>
          <div className="mt-6 divide-y divide-line-2">
            {props.suggestions.map((suggestion) => <button key={suggestion} type="button" disabled={props.readOnly} onClick={() => props.onSend(suggestion)} className="flex w-full items-center gap-3 py-3 text-left text-[12px] leading-relaxed text-ink-500 hover:text-plum disabled:opacity-50">
              <span className="min-w-0 flex-1">{suggestion}</span><LuArrowUpRight className="shrink-0" aria-hidden />
            </button>)}
          </div>
        </div>}
      </div>
      <Composer variant="split" draftText={props.draftText} onDraftChange={props.onDraftChange} onSend={props.onSend} onSuggest={props.onSuggest} suggestions={[]} connectedCount={props.connectedCount} placeholder="Ask about your campaigns..." model={props.model} onModelChange={props.onModelChange} isStreaming={props.isStreaming} onStop={props.onStop} canUseOpus={props.canUseOpus} readOnly={props.readOnly} />
    </div>
  );
}

export function PaidWorkspaceFrame({ children, chat, chatOpen, onClose }: {
  children: React.ReactNode;
  chat: React.ReactNode;
  chatOpen: boolean;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!chatOpen) return;
    const media = window.matchMedia("(max-width: 1279px)");
    const previous = document.activeElement as HTMLElement | null;
    const applyOverlay = () => {
      if (frameRef.current) frameRef.current.inert = media.matches;
      panelRef.current?.setAttribute("role", media.matches ? "dialog" : "complementary");
      if (media.matches) {
        panelRef.current?.setAttribute("aria-modal", "true");
        panelRef.current?.focus();
      } else panelRef.current?.removeAttribute("aria-modal");
    };
    const keydown = (event: KeyboardEvent) => {
      const activeDialog = document.activeElement?.closest('[role="dialog"]');
      if (event.defaultPrevented || (activeDialog && activeDialog !== panelRef.current)) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab" || !media.matches || !panelRef.current) return;
      const controls = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], textarea:not([disabled]), select:not([disabled]), summary')).filter((node) => node.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    applyOverlay();
    media.addEventListener("change", applyOverlay);
    window.addEventListener("keydown", keydown);
    const frame = frameRef.current;
    const panel = panelRef.current;
    return () => {
      if (frame) frame.inert = false;
      media.removeEventListener("change", applyOverlay);
      window.removeEventListener("keydown", keydown);
      if (panel?.contains(document.activeElement) || document.activeElement === document.body) previous?.focus();
    };
  }, [chatOpen, onClose]);

  return <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <div ref={frameRef} className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    {chatOpen ? <>
      <div className="absolute inset-0 z-30 bg-black/20 xl:hidden" aria-hidden onClick={onClose} />
      <aside ref={panelRef} id="paid-chat-panel" tabIndex={-1} aria-labelledby="paid-chat-title" className="absolute inset-y-0 right-0 z-40 w-full max-w-[390px] shrink-0 border-l border-line-2 outline-none xl:static xl:z-auto xl:w-[360px] 2xl:w-[390px]">{chat}</aside>
    </> : null}
  </div>;
}
