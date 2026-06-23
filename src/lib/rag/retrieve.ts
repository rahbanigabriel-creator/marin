import "server-only";
import { loadCorpus, type RagDoc } from "./corpus";

/**
 * Doctrine retriever (RAG layer, architecture §4). The zero-connector brain
 * grounds its reasoning in the doctrine corpus, so EVERY answer can retrieve the
 * relevant framework before reaching for account data or the web.
 *
 * GRACEFUL-WITHOUT-KEYS: the default path is a dependency-free LEXICAL retriever
 * (BM25-style token overlap + trigger-phrase / metric / domain boosts). It needs
 * NO env, NO embeddings, NO network — it is the foundation, not an upgrade.
 *
 * GATED UPGRADE: rankByEmbedding() is a clean seam that swaps in pgvector+Voyage
 * semantic ranking when VOYAGE_API_KEY is set (isVectorSearchEnabled()). It is
 * intentionally a stub today: lexical is the default and the only path the build
 * depends on. Wiring the vector store is a later module; the seam keeps that
 * additive and keeps callers stable.
 *
 * RANKING DESIGN (why a naive term-frequency scorer is not enough): the doctrine
 * is a family of diagnostic frameworks that reference one another. A pure body
 * match for "why is my ROAS down" surfaces ROAS/ATTRIB/CAC but drops the master
 * disambiguation (DOC-DIAG-4WAY) and the priors (DOC-DIAG-000). Those two are
 * the doctrine's non-negotiable starting points, so we GUARANTEE-INCLUDE them
 * for any "why did X change" query and CO-RETRIEVE the diagnostic family, on top
 * of the lexical score. The result is auditable and deterministic.
 */

export interface RetrieveOptions {
  /** Max parent docs to return. Default 5. */
  topK?: number;
  /**
   * Optional intent hint from the agent's classifier (strategy | diagnostic |
   * competitor | seo-geo | measurement | tactical | action). Used as a soft
   * domain boost only — never as a hard filter, so it can't starve retrieval.
   */
  intent?: string;
}

export interface RetrievedDoc {
  docId: string;
  docType: RagDoc["docType"];
  score: number;
  /** Why this doc was included (lexical | prior | diagnostic-family | intent). */
  reasons: string[];
  /** Full markdown body the model grounds on. */
  body: string;
}

/** Priors that anchor every metric-movement diagnosis (corpus A0 + master 4WAY). */
const DIAG_PRIORS = ["DOC-DIAG-000", "DOC-DIAG-4WAY"] as const;

/**
 * "Why did X change" detector. Matches the natural phrasings the doctrine's
 * DOC-DIAG-000 philosophy is written to answer ("why is/are/did/has my … "),
 * plus the explicit drop/decline/spike/rising vocabulary, so a metric-movement
 * question reliably triggers the guaranteed-include priors.
 */
const WHY_CHANGE_RE =
  /\b(why|diagnos\w*|root[\s-]?cause)\b|\b(drop|dropp\w+|declin\w+|falling|fell|spik\w+|rising|rose|surg\w+|tank\w+|went (up|down)|going (up|down)|worse|down|up)\b/i;

/** Map a few common intent labels onto corpus domains for a soft boost. */
const INTENT_DOMAIN: Record<string, string[]> = {
  diagnostic: ["diagnostics"],
  strategy: ["strategy", "growth", "funnel", "unit-economics"],
  competitor: ["competitor", "research"],
  "seo-geo": ["seo", "geo"],
  seo: ["seo", "geo"],
  geo: ["geo", "seo"],
  measurement: ["attribution", "measurement", "mmm", "incrementality"],
  tactical: ["paid", "creative"],
};

const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "do", "does", "did", "for",
  "from", "has", "have", "how", "i", "in", "is", "it", "its", "me", "my", "of",
  "on", "or", "so", "that", "the", "their", "them", "they", "this", "to", "up",
  "was", "we", "what", "when", "where", "which", "who", "why", "with", "you",
  "your", "should", "would", "could", "can", "get", "got", "am",
]);

/** Lowercase + split into alphanumeric tokens, dropping stopwords + 1-char noise. */
function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length > 1 && !STOPWORDS.has(t),
  );
}

/** Light singular/plural folding so "competitors" matches "competitor". */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.length > 3 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

interface ScoredDoc {
  doc: RagDoc;
  score: number;
  reasons: Set<string>;
}

/**
 * BM25-ish lexical score of one doc against the query tokens. We weight the
 * structured metadata (trigger phrases, metrics, domain) far above raw body
 * frequency, because the frontmatter is hand-curated to encode WHICH question
 * each doc answers — exactly the signal a bag-of-words body match washes out.
 */
function lexicalScore(doc: RagDoc, qTokens: string[], qStems: Set<string>, queryLower: string): { score: number; reasons: Set<string> } {
  const reasons = new Set<string>();
  let score = 0;

  // (1) Trigger-phrase overlap — the strongest signal. A full phrase contained
  //     in the query is a near-certain hit; partial token overlap still counts.
  for (const phrase of doc.triggerPhrases) {
    const p = phrase.toLowerCase().trim();
    if (!p) continue;
    if (queryLower.includes(p)) {
      score += 12;
      reasons.add("trigger-phrase");
      continue;
    }
    const phraseStems = new Set(tokenize(p).map(stem));
    if (phraseStems.size === 0) continue;
    let hit = 0;
    for (const s of phraseStems) if (qStems.has(s)) hit++;
    const coverage = hit / phraseStems.size;
    if (coverage > 0) {
      score += 6 * coverage;
      if (coverage >= 0.6) reasons.add("trigger-phrase");
    }
  }

  // (2) Metric tokens — a query naming a metric ("roas", "cac", "ltv") should
  //     pull the doc that reasons about it.
  for (const metric of doc.metrics) {
    const mStems = tokenize(metric).map(stem);
    if (mStems.length && mStems.every((s) => qStems.has(s))) {
      score += 5;
      reasons.add("metric");
    }
  }

  // (3) Domain tokens — softer topical alignment ("competitor", "strategy").
  for (const dom of doc.domain) {
    const dStems = tokenize(dom).map(stem);
    if (dStems.length && dStems.every((s) => qStems.has(s))) {
      score += 3;
      reasons.add("domain");
    }
  }

  // (4) doc_id token overlap (e.g. query literally says "ROAS" → DOC-DIAG-ROAS).
  const idStems = new Set(tokenize(doc.docId.replace(/^DOC-/i, "").replace(/-/g, " ")).map(stem));
  for (const s of qStems) if (idStems.has(s)) { score += 2; reasons.add("doc-id"); }

  // (5) Body term frequency — the weakest signal, capped so a long doc with many
  //     incidental mentions can't outrank a precisely-tagged short doc.
  let bodyHits = 0;
  for (const s of qStems) {
    // word-boundary count, stem-tolerant via the raw token prefix
    if (doc.bodyLower.includes(s)) bodyHits++;
  }
  if (qStems.size > 0) {
    score += Math.min(4, (bodyHits / qStems.size) * 4);
  }

  return { score, reasons };
}

/**
 * Retrieve the top-k doctrine parent docs for a query, lexically (no key).
 *
 * Guarantees that make the doctrine usable as a diagnostic engine:
 *   • For any "why did X change" query, DOC-DIAG-000 (the waterfall priors) and
 *     DOC-DIAG-4WAY (the master disambiguation) are ALWAYS included.
 *   • A diagnostic-family query co-retrieves sibling diagnostic frameworks so the
 *     model can disambiguate look-alike causes, not just the single best match.
 */
export function retrieveDoctrine(query: string, opts: RetrieveOptions = {}): RetrievedDoc[] {
  const topK = Math.max(1, opts.topK ?? 5);
  const corpus = loadCorpus();
  if (corpus.length === 0) return [];

  const queryLower = query.toLowerCase();
  const qTokens = tokenize(query);
  const qStems = new Set(qTokens.map(stem));
  const intentDomains = opts.intent ? (INTENT_DOMAIN[opts.intent.toLowerCase()] ?? []) : [];

  const byId = new Map<string, RagDoc>();
  for (const d of corpus) byId.set(d.docId.toUpperCase(), d);

  const scored: ScoredDoc[] = corpus.map((doc) => {
    const { score, reasons } = lexicalScore(doc, qTokens, qStems, queryLower);
    let s = score;
    // Soft intent boost: nudge docs whose domain matches the classified intent.
    if (intentDomains.length && doc.domain.some((d) => intentDomains.includes(d.toLowerCase()))) {
      s += 2;
      reasons.add("intent");
    }
    return { doc, score: s, reasons };
  });

  const picked = new Map<string, ScoredDoc>();
  const add = (entry: ScoredDoc) => {
    const key = entry.doc.docId.toUpperCase();
    const existing = picked.get(key);
    if (!existing) {
      picked.set(key, entry);
    } else {
      existing.score = Math.max(existing.score, entry.score);
      for (const r of entry.reasons) existing.reasons.add(r);
    }
  };

  const isWhyChange = WHY_CHANGE_RE.test(query);

  // ── Guarantee-include the diagnostic priors for any metric-movement query ──
  if (isWhyChange) {
    for (const id of DIAG_PRIORS) {
      const doc = byId.get(id);
      if (doc) {
        const base = scored.find((x) => x.doc.docId.toUpperCase() === id);
        const entry: ScoredDoc = {
          doc,
          // Keep them near the top: their own lexical score plus a prior boost,
          // but the best lexical match still leads (it answers the exact metric).
          score: (base?.score ?? 0) + 9,
          reasons: new Set([...(base?.reasons ?? []), "prior"]),
        };
        add(entry);
      }
    }
  }

  // ── Top lexical matches ──
  const ranked = [...scored].sort((a, b) => b.score - a.score || a.doc.docId.localeCompare(b.doc.docId));
  for (const entry of ranked) {
    if (entry.score <= 0) break;
    add(entry);
  }

  // ── Diagnostic-family co-retrieval: if the best match is a diagnostic
  //    framework, ensure the master disambiguation (4WAY) rides along so the
  //    model can separate campaign / bid / competitor / exogenous causes. ──
  const top = ranked[0];
  if (top && top.score > 0 && top.doc.docType === "diagnostic_framework") {
    const fourWay = byId.get("DOC-DIAG-4WAY");
    if (fourWay) {
      const base = scored.find((x) => x.doc.docId.toUpperCase() === "DOC-DIAG-4WAY");
      add({
        doc: fourWay,
        score: (base?.score ?? 0) + 7,
        reasons: new Set([...(base?.reasons ?? []), "diagnostic-family"]),
      });
    }
  }

  return [...picked.values()]
    .sort((a, b) => b.score - a.score || a.doc.docId.localeCompare(b.doc.docId))
    .slice(0, topK)
    .map((e) => ({
      docId: e.doc.docId,
      docType: e.doc.docType,
      score: Math.round(e.score * 100) / 100,
      reasons: [...e.reasons],
      body: e.doc.body,
    }));
}

/**
 * Render retrieved docs into a single markdown block for the model to ground on.
 * Each doc is fenced with its id so the model can cite which framework it used.
 */
export function formatRetrieved(docs: RetrievedDoc[]): string {
  if (docs.length === 0) {
    return "(no doctrine matched this query — answer from first principles and flag the uncertainty)";
  }
  return docs
    .map((d) => `### ${d.docId} (${d.docType})\n${d.body}`)
    .join("\n\n---\n\n");
}

// ───────────────────────────── Vector seam (gated) ─────────────────────────

/**
 * True only when the embeddings upgrade is configured. Lexical retrieval is the
 * default and needs no key; this gate keeps the pgvector+Voyage path strictly
 * additive so the build never depends on it.
 */
export function isVectorSearchEnabled(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

/**
 * Semantic rerank seam. When VOYAGE_API_KEY is set this is where the candidate
 * docs get re-scored by pgvector cosine similarity over Voyage embeddings. Until
 * the vector store ships it is a transparent pass-through: it returns the lexical
 * order unchanged, so enabling the key today changes nothing rather than throwing.
 *
 * The signature is the upgrade contract: callers always go through retrieveDoctrine
 * (lexical first-pass) and may opt into rankByEmbedding() to reorder; the lexical
 * candidates are the recall set, embeddings are the precision rerank.
 */
export async function rankByEmbedding(
  query: string,
  candidates: RetrievedDoc[],
): Promise<RetrievedDoc[]> {
  if (!isVectorSearchEnabled()) return candidates; // lexical-only (default)
  // TODO(rag-vector): embed `query` with Voyage, fetch doc vectors from pgvector,
  // rerank `candidates` by cosine similarity. Until that module lands we return
  // the lexical order so the gated path is a safe no-op.
  void query;
  return candidates;
}
