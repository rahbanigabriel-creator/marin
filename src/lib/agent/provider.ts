import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic client lifecycle + live-agent gating. Server-only (imported only by
 * the agent loop, which is imported only by the /api/chat route). When no key is
 * configured the caller falls back to a deterministic canned lead.
 */
export class MissingApiKeyError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set");
    this.name = "MissingApiKeyError";
  }
}

/** True when a key is present and the live agent isn't explicitly disabled. */
export function isLiveAgentEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.USE_LIVE_AGENT !== "false";
}

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new MissingApiKeyError();
  if (!client) client = new Anthropic(); // resolves ANTHROPIC_API_KEY from env
  return client;
}
