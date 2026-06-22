import "server-only";

import { PostHog } from "posthog-node";

/**
 * Server-side product analytics (PostHog, Stack C).
 *
 * Graceful without keys (mirrors src/lib/agent/provider.ts and src/lib/db.ts):
 *   • Importing this module NEVER constructs a client or touches the network.
 *   • The client is lazily created on first capture(), and ONLY when
 *     NEXT_PUBLIC_POSTHOG_KEY is present. With no key, capture() is a silent
 *     no-op that never throws and never opens a connection — so `next build`
 *     and `tsc --noEmit` stay green with no env, and the live agent / mockup
 *     are completely unaffected.
 *
 * EU data residency: the host defaults to the PostHog EU ingestion endpoint
 * (https://eu.i.posthog.com). Override with NEXT_PUBLIC_POSTHOG_HOST only to
 * another EU-region host. No US endpoint is ever hardcoded.
 *
 * Security: never pass secrets/tokens as event properties; PostHog events are
 * product telemetry, not a log sink. We never log the key.
 */

/** PostHog EU ingestion host (data residency). The public client key is safe to
 * expose; capture authorisation is scoped to ingestion only. */
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

/** True when PostHog is configured (key present). Read lazily from env on every
 * call — never at import — so the gate reflects the runtime environment. */
export function isAnalyticsConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

let client: PostHog | null = null;

/**
 * Lazily resolve the server PostHog client, or null when unconfigured. The
 * client is constructed at most once. flushAt:1 + a short flushInterval keep
 * serverless invocations from buffering events past the request lifetime.
 */
function getClient(): PostHog | null {
  if (!isAnalyticsConfigured()) return null;
  if (!client) {
    client = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY as string, {
      host: POSTHOG_HOST,
      // Serverless-friendly: emit promptly rather than buffering across the
      // (short-lived) function invocation.
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}

/** A PostHog event property bag. Keep these free of any secret or token. */
export type AnalyticsProps = Record<string, unknown>;

/**
 * Capture a server-side product event. No-op (and never throws) when PostHog is
 * not configured. Any transport error is swallowed and logged at warn — analytics
 * must never break a request path (e.g. the chat answer stream).
 *
 * @param event       Event name, e.g. "answer_generated".
 * @param distinctId  Stable subject id (workspace id is a good default). Falls
 *                     back to "anonymous" when none is known.
 * @param properties  Non-sensitive event properties.
 */
export function capture(
  event: string,
  distinctId: string | null | undefined,
  properties?: AnalyticsProps,
): void {
  const ph = getClient();
  if (!ph) return; // unconfigured → no-op
  try {
    ph.capture({
      distinctId: distinctId || "anonymous",
      event,
      properties,
    });
  } catch (err) {
    // Never let analytics surface to the caller.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[analytics] capture("${event}") failed: ${msg}`);
  }
}

/**
 * Flush any buffered events. Safe to await in serverless handlers before the
 * function suspends so queued events are delivered. No-op when unconfigured.
 */
export async function flushAnalytics(): Promise<void> {
  const ph = getClient();
  if (!ph) return;
  try {
    await ph.flush();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[analytics] flush failed: ${msg}`);
  }
}
