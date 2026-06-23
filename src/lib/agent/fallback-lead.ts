import "server-only";
import { retrieveDoctrine, type RetrievedDoc } from "@/lib/rag/retrieve";

/**
 * Keyless / offline honest lead (Phase-1 constraint #2: NO fake data).
 *
 * When the live agent is unavailable (no ANTHROPIC_API_KEY, or a generation
 * error) AND demo mode is OFF, the chat route must NOT fall back to the canned
 * scenario lead — those leads carry fabricated euro figures ("€612k revenue",
 * "4.6× ROAS", "€11.5k leaking") presented as the user's real data. That is the
 * exact bug Phase 1 exists to eliminate.
 *
 * This module produces a DETERMINISTIC, doctrine-grounded lead with ZERO
 * fabricated numbers, using the same lexical retriever the live agent uses (no
 * key required). It states which framework applies and what connecting an
 * account would unlock — it never invents the user's metrics or graphs.
 *
 * GRACEFUL-WITHOUT-KEYS: pure lexical retrieval + string assembly. No env, no
 * network. If retrieval returns nothing it degrades to a generic-but-honest
 * connect prompt — still no fabricated data.
 */

/** Human-readable label for each doc type, for the lead prose. */
const DOC_TYPE_LABEL: Record<RetrievedDoc["docType"], string> = {
  philosophy: "first-principles",
  diagnostic_framework: "diagnostic",
  practitioner: "practitioner",
  strategic: "strategic",
};

/** Pull a short, number-free orienting sentence from a retrieved doc body. */
function leadSentenceFrom(doc: RetrievedDoc): string | null {
  // Strip markdown headings/frontmatter noise and take the first substantive
  // prose sentence. We deliberately avoid any line that contains a currency or
  // percentage figure so we never echo an illustrative number as if it were the
  // user's real metric.
  const lines = doc.body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("#") && !l.startsWith("---") && !l.startsWith("- ") && !l.startsWith("* "));
  for (const rawLine of lines) {
    if (/[€$£%]|\d{2,}/.test(rawLine)) continue; // skip lines carrying figures
    // Drop a leading "**DOC-ID | title**" heading prefix (quoted or not) so the
    // lead reads as prose, not as a doc header echoed back at the user.
    const line = rawLine
      .replace(/^\*{2}DOC-[A-Z0-9-]+\s*\|[^*]*\*{2}\s*/i, "") // bolded "**DOC-X | …**"
      .replace(/^DOC-[A-Z0-9-]+\s*\|\s*"[^"]*"\s*/i, "") // bare "DOC-X | "title""
      .replace(/[*_`]/g, "")
      .trim();
    if (line.length < 24) continue;
    // First sentence only, capped.
    const sentence = line.split(/(?<=[.!?])\s/)[0].trim();
    if (sentence.length >= 24) return sentence.length > 220 ? sentence.slice(0, 217) + "…" : sentence;
  }
  return null;
}

/**
 * Build an honest, doctrine-grounded lead for the keyless/offline default path.
 * Never contains fabricated account numbers. Returns 2–3 plain sentences.
 */
export function buildOfflineDoctrineLead(question: string, persona?: string): string {
  void persona;
  let docs: RetrievedDoc[] = [];
  try {
    docs = retrieveDoctrine(question, { topK: 3 });
  } catch {
    docs = [];
  }

  if (docs.length === 0) {
    return (
      "I can answer this from marketing doctrine and first principles, but I won't invent numbers for your account. " +
      "Connect Google Ads, Meta, GA4 or Search Console and I'll ground every figure in your real data; until then, ask me anything strategic and I'll reason it through with you."
    );
  }

  const primary = docs[0];
  const frameworkLabel = DOC_TYPE_LABEL[primary.docType] ?? "doctrine";
  const orient = leadSentenceFrom(primary);
  const ids = docs.map((d) => d.docId).join(", ");

  const opener = orient
    ? `${orient} (applying Marpin's ${frameworkLabel} framework ${primary.docId}).`
    : `Here's how Marpin's ${frameworkLabel} framework ${primary.docId} approaches this.`;

  return (
    `${opener} ` +
    `I'm answering from doctrine (${ids}) rather than your account — to keep this honest I won't fabricate your numbers or graphs. ` +
    `Connect an account and I'll ground every figure in your real data.`
  );
}
