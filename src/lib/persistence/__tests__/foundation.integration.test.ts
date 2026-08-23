import assert from "node:assert/strict";
import test from "node:test";

import {
  getBrand,
  getPrimaryBrandPromptContext,
  updateBrand,
  upsertPrimaryBrand,
} from "../../brand/service";
import {
  archiveConversation,
  createConversation,
  getConversation,
  listConversations,
  persistMessage,
} from "../../conversations/service";
import { prisma } from "../../db";

function disposableDatabaseEnabled(): boolean {
  if (process.env.MARPIN_INTEGRATION_DATABASE !== "1") return false;
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    const isLocal = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    const isDisposable = /(?:_test|_ci)$/.test(url.pathname.slice(1));
    return isLocal && isDisposable;
  } catch {
    return false;
  }
}

const integrationTest = disposableDatabaseEnabled() ? test : test.skip;

integrationTest("brand memory and conversations persist safely across tenants and retries", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await prisma.workspace.create({
    data: { name: "Sprint 2", slug: `sprint-2-${suffix}` },
  });
  const otherWorkspace = await prisma.workspace.create({
    data: { name: "Other tenant", slug: `other-${suffix}` },
  });

  try {
    const brand = await upsertPrimaryBrand(workspace.id, {
      name: "Wrong detected name",
      websiteUrl: "https://example.com/",
      summary: "Initial audit summary",
      audience: ["Solo founders"],
      voice: ["Clear", "Practical"],
      locale: "en_es",
      timezone: "Europe/Madrid",
      currency: "eur",
    });

    assert.equal(brand.contextVersion, 1);
    assert.equal(brand.locale, "en-ES");
    assert.equal(brand.currency, "EUR");
    assert.equal(await getBrand(otherWorkspace.id, brand.id), null);

    const defaults = await prisma.workspace.findUniqueOrThrow({ where: { id: workspace.id } });
    assert.equal(defaults.timezone, "Europe/Madrid");
    assert.equal(defaults.locale, "en-ES");
    assert.equal(defaults.currency, "EUR");

    const corrected = await updateBrand(workspace.id, brand.id, {
      name: "Marpin",
      summary: "The distribution operating system for solo software founders.",
      voice: ["Direct", "Evidence-led"],
    });
    assert.equal(corrected?.name, "Marpin");
    assert.equal(corrected?.contextVersion, 2);

    const promptContext = await getPrimaryBrandPromptContext(workspace.id);
    assert.equal(promptContext?.name, "Marpin");
    assert.deepEqual(promptContext?.voice, ["Direct", "Evidence-led"]);
    assert.equal(promptContext?.timezone, "Europe/Madrid");

    const conversation = await createConversation({
      workspaceId: workspace.id,
      question: "Plan next week for our corrected Marpin brand",
      mode: "organic",
    });
    assert.equal(conversation.brandId, brand.id);
    assert.equal(conversation.mode, "organic");

    await persistMessage({
      workspaceId: workspace.id,
      conversationId: conversation.id,
      role: "user",
      turnId: "turn-1",
      content: "Plan next week",
    });
    await persistMessage({
      workspaceId: workspace.id,
      conversationId: conversation.id,
      role: "user",
      turnId: "turn-1",
      content: "Plan next week for Madrid",
    });
    await persistMessage({
      workspaceId: workspace.id,
      conversationId: conversation.id,
      role: "assistant",
      turnId: "turn-1",
      content: "Partial answer",
      metadata: { completion: "partial" },
    });
    await persistMessage({
      workspaceId: workspace.id,
      conversationId: conversation.id,
      role: "assistant",
      turnId: "turn-1",
      content: "Final corrected answer",
      metadata: { completion: "complete", chips: ["Build calendar"] },
    });

    const restored = await getConversation(workspace.id, conversation.id);
    assert.equal(restored?.messages.length, 2);
    assert.equal(restored?.messages[0]?.content, "Plan next week for Madrid");
    assert.equal(restored?.messages[1]?.content, "Final corrected answer");
    assert.deepEqual(restored?.messages[1]?.metadata, {
      completion: "complete",
      chips: ["Build calendar"],
    });
    assert.equal(await getConversation(otherWorkspace.id, conversation.id), null);
    assert.equal((await listConversations(workspace.id)).length, 1);
    assert.equal(await archiveConversation(workspace.id, conversation.id), true);
    assert.equal((await listConversations(workspace.id)).length, 0);
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.workspace.delete({ where: { id: otherWorkspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
