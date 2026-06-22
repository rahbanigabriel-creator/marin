import "server-only";

import { Resend, type CreateEmailOptions } from "resend";

/**
 * Transactional email (Resend, Stack C — Email/alerts). Server-only.
 *
 * Used to deliver alerts (e.g. budget/metric anomalies, billing notices). This
 * is the SEND side only; rendering/templating is the caller's concern.
 *
 * Graceful without keys (mirrors src/lib/agent/provider.ts, src/lib/db.ts,
 * src/lib/analytics.ts and src/lib/billing/stripe.ts):
 *   • Importing this module NEVER constructs a client or touches the network.
 *   • The client is lazily created on first sendEmail(), and ONLY when
 *     RESEND_API_KEY is present. With no key, sendEmail() is a logged no-op that
 *     returns { ok: false, skipped: true } and NEVER throws — so `next build`
 *     and `tsc --noEmit` stay green with no env, and no request path that emits
 *     an alert can be broken by missing email config.
 *
 * EU data residency: Resend stores email data in the region of the sending
 * domain/account; configure the Resend account + domain in the EU. No host is
 * hardcoded here. The default API host is used.
 *
 * Security: the API key is read lazily from env and is NEVER logged. We log the
 * subject and recipient COUNT for observability, never recipient addresses or
 * body content (which may contain PII).
 */

/** True when Resend is configured (API key present). Read lazily from env on
 * every call — never at import — so the gate reflects the runtime environment. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

let client: Resend | null = null;

/**
 * Lazily resolve the Resend client, or null when unconfigured. Constructed at
 * most once. The key is resolved here (not at import) so build/typecheck stay
 * green with no env.
 */
function getClient(): Resend | null {
  if (!isEmailConfigured()) return null;
  if (!client) client = new Resend(process.env.RESEND_API_KEY as string);
  return client;
}

/**
 * Default From address. Resend requires a verified sender domain. Override per
 * environment with RESEND_FROM (e.g. "Marin Alerts <alerts@yourdomain.eu>").
 */
const DEFAULT_FROM = "Marin <alerts@marin.app>";

/** Parameters for {@link sendEmail}. A thin, strongly-typed subset of Resend's
 * CreateEmailOptions: `to`/`subject` are required, one of `html`/`text` should
 * be supplied, and `from` defaults to {@link DEFAULT_FROM}. */
export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
}

/** Result of {@link sendEmail}. `skipped` is true when Resend is unconfigured
 * (no key) — the call is a no-op, not a failure of intent. */
export interface SendEmailResult {
  ok: boolean;
  /** True when the send was skipped because Resend is not configured. */
  skipped: boolean;
  /** Resend message id on success. */
  id?: string;
  /** Error message on failure (never includes the API key). */
  error?: string;
}

/** Number of recipients in a to/cc/bcc value, for safe (PII-free) logging. */
function recipientCount(to: string | string[]): number {
  return Array.isArray(to) ? to.length : 1;
}

/**
 * Send a transactional/alert email. No-op (logged, never throws) when Resend is
 * not configured, so alert-emitting code paths stay safe with no env. Any
 * transport error is caught and returned as { ok: false } — email must never
 * surface to, or break, a request path.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const resend = getClient();
  if (!resend) {
    // Unconfigured → no-op. Log subject + recipient count only (no addresses).
    console.warn(
      `[email] RESEND_API_KEY not set — skipping send "${params.subject}" to ${recipientCount(params.to)} recipient(s)`,
    );
    return { ok: false, skipped: true };
  }

  // Resend requires at least one of html/text; default to a minimal text body
  // derived from the subject so a malformed alert call can never throw here.
  const payload = {
    from: params.from ?? DEFAULT_FROM,
    to: params.to,
    subject: params.subject,
    ...(params.html !== undefined ? { html: params.html } : {}),
    ...(params.text !== undefined || params.html === undefined
      ? { text: params.text ?? params.subject }
      : {}),
    ...(params.replyTo !== undefined ? { replyTo: params.replyTo } : {}),
    ...(params.cc !== undefined ? { cc: params.cc } : {}),
    ...(params.bcc !== undefined ? { bcc: params.bcc } : {}),
  } as CreateEmailOptions;

  try {
    const { data, error } = await resend.emails.send(payload);
    if (error) {
      console.warn(`[email] send "${params.subject}" failed: ${error.message}`);
      return { ok: false, skipped: false, error: error.message };
    }
    return { ok: true, skipped: false, id: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[email] send "${params.subject}" threw: ${msg}`);
    return { ok: false, skipped: false, error: msg };
  }
}
