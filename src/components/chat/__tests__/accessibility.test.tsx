import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Composer } from "@/components/chat/Composer";
import { AgentActivity } from "@/components/chat/AgentActivity";
import { SplitView } from "@/components/views/SplitView";
import type { Scenario } from "@/types/scenario";

const scenario: Scenario = {
  id: "accessibility-test",
  persona: "founder",
  title: "Audit",
  question: "Audit my site",
  keywords: [],
  lead: "",
  chips: [],
  artifacts: [],
  closing: { split: "", thread: "" },
};

const noop = () => {};

test("streaming composer exposes named Stop and Model controls", () => {
  const html = renderToStaticMarkup(
    <Composer
      variant="thread"
      onSend={noop}
      onSuggest={noop}
      suggestions={[]}
      connectedCount={0}
      model="auto"
      onModelChange={noop}
      isStreaming
      onStop={noop}
    />,
  );

  assert.match(html, /aria-label="Stop response"/);
  assert.match(html, /aria-label="Model"/);
  assert.match(html, /placeholder="Ask a follow-up/);
  assert.doesNotMatch(html, />Send message</);
});

test("typed chat failures render a live alert with a retry command", () => {
  const html = renderToStaticMarkup(
    <SplitView
      step={1}
      turns={[]}
      typed="Partial answer"
      status={null}
      error="Marpin could not finish this answer."
      isStreaming={false}
      done={false}
      onStop={noop}
      onRetry={noop}
      question={scenario.question}
      scenario={scenario}
      artifacts={[]}
      chips={[]}
      closing={null}
      onSend={noop}
      onSuggest={noop}
      suggestions={[]}
      choices={null}
      onChoose={noop}
      dataMode="empty"
      onOpenConnections={noop}
      connectedCount={0}
      channels={[]}
      onConnect={noop}
      model="auto"
      onModelChange={noop}
    />,
  );

  assert.match(html, /role="alert"/);
  assert.match(html, />Retry</);
  assert.match(html, /Partial answer/);
});

test("activity UI exposes concise status without a reasoning surface", () => {
  const html = renderToStaticMarkup(
    <AgentActivity status={{ key: "analyzing", label: "Reviewing your data" }} answering={false} />,
  );

  assert.match(html, /Reviewing your data/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /thinking|reasoning|chain.of.thought/i);
});
