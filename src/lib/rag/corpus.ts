import "server-only";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Corpus loader (RAG layer, architecture §4). Reads every doctrine doc under
 * src/lib/rag/corpus/*.md, parses the YAML frontmatter into typed metadata, and
 * keeps the full prose body. Server-only (fs); the markdown is the source of
 * truth — this module never invents content, it only structures it for retrieval.
 *
 * GRACEFUL-WITHOUT-KEYS: loading the corpus needs no env at all (pure fs + a
 * tiny frontmatter parser). It is the foundation of the zero-connector brain.
 *
 * Loading strategy: the corpus markdown lives next to this file, so we resolve
 * the directory relative to the module (import.meta.url) with a process.cwd()
 * fallback. We read lazily + memoize, so a missing/relocated corpus directory
 * never throws at import time — callers get an empty corpus and degrade, exactly
 * like every other module here behaves when its inputs are absent.
 */

export type DocType = "philosophy" | "diagnostic_framework" | "practitioner" | "strategic";
export type Volatility = "high" | "low";

export interface RagDoc {
  /** Stable doc identifier, e.g. "DOC-DIAG-ROAS" (also the filename stem). */
  docId: string;
  docType: DocType;
  /** Topical domains, e.g. ["diagnostics","paid"]. */
  domain: string[];
  /** Channels/surfaces the doc covers, e.g. ["meta","google-ads"]. */
  platforms: string[];
  /** Metric tokens the doc reasons about, e.g. ["roas","cpa"]. */
  metrics: string[];
  /** Natural-language phrases that should retrieve this doc. */
  triggerPhrases: string[];
  volatility: Volatility;
  /** ISO date (yyyy-mm-dd) the doc was last reviewed. */
  lastReviewed: string;
  /** Full markdown prose body (frontmatter stripped). */
  body: string;
  /** Lowercased body, cached for lexical scoring. */
  bodyLower: string;
}

const DOC_TYPES: ReadonlySet<string> = new Set([
  "philosophy",
  "diagnostic_framework",
  "practitioner",
  "strategic",
]);

/**
 * Resolve the corpus directory across tsx / dev / standalone-serverless contexts.
 *
 * The .md files are read at runtime, so WHERE they live depends on the bundler:
 *   • tsx / dev: alongside this module → <here>/corpus.
 *   • Next standalone trace: outputFileTracingIncludes (next.config.ts) ships
 *     the corpus, but the file tree the tracer reproduces is keyed off the
 *     PROJECT ROOT, so the files land at <cwd>/src/lib/rag/corpus (or, in some
 *     standalone layouts, under the traced module dir). We can't assume one
 *     layout, so we probe an ordered list of candidates and return the first
 *     directory that actually contains corpus markdown.
 *
 * Returning the first EXISTING + non-empty candidate (rather than a single
 * guessed path) is what makes the prod trace robust: if the tracer puts the
 * corpus anywhere we know about, loadCorpus() finds it instead of silently
 * degrading to an empty corpus.
 */
function corpusDirCandidates(): string[] {
  const candidates: string[] = [];
  // Primary: relative to this module's source file (tsx + runtimes that keep
  // the file tree intact next to the compiled module).
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(here, "corpus"));
  } catch {
    /* import.meta.url unavailable in this runtime */
  }
  // Project-root-relative layouts produced by Next's file tracer / standalone.
  const cwd = process.cwd();
  candidates.push(join(cwd, "src", "lib", "rag", "corpus"));
  candidates.push(join(cwd, "lib", "rag", "corpus"));
  return candidates;
}

/** First candidate dir that exists and holds at least one .md file, else null. */
function resolveCorpusDir(): string | null {
  for (const dir of corpusDirCandidates()) {
    try {
      const md = readdirSync(dir).some((f) => f.toLowerCase().endsWith(".md"));
      if (md) return dir;
    } catch {
      /* not this candidate — try the next */
    }
  }
  return null;
}

/** Minimal, dependency-free YAML-frontmatter splitter: returns [meta, body]. */
function splitFrontmatter(raw: string): { meta: string; body: string } {
  const text = raw.replace(/^﻿/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: "", body: text.trim() };
  return { meta: match[1], body: text.slice(match[0].length).trim() };
}

/** Parse the small, well-known frontmatter schema (scalars + inline/block lists). */
function parseFrontmatter(meta: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const lines = meta.split(/\r?\n/);
  let currentKey: string | null = null;
  let blockList: string[] | null = null;

  const flush = () => {
    if (currentKey && blockList) out[currentKey] = blockList;
    currentKey = null;
    blockList = null;
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    // Block-list item: "  - value"
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && currentKey) {
      (blockList ??= []).push(stripQuotes(item[1].trim()));
      continue;
    }
    // "key: value" (value optional → block list follows)
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (kv) {
      flush();
      const key = kv[1];
      const value = kv[2].trim();
      if (value === "") {
        currentKey = key;
        blockList = [];
      } else if (value.startsWith("[") && value.endsWith("]")) {
        out[key] = value
          .slice(1, -1)
          .split(",")
          .map((s) => stripQuotes(s.trim()))
          .filter(Boolean);
      } else {
        out[key] = stripQuotes(value);
      }
    }
  }
  flush();
  return out;
}

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).map((s) => s.trim()).filter(Boolean);
}

function coerceDocType(v: string | string[] | undefined): DocType {
  const s = (Array.isArray(v) ? v[0] : v) ?? "";
  return DOC_TYPES.has(s) ? (s as DocType) : "strategic";
}

function coerceVolatility(v: string | string[] | undefined): Volatility {
  return (Array.isArray(v) ? v[0] : v) === "high" ? "high" : "low";
}

function parseDoc(stem: string, raw: string): RagDoc {
  const { meta, body } = splitFrontmatter(raw);
  const fm = parseFrontmatter(meta);
  const docId = (typeof fm.doc_id === "string" && fm.doc_id) || stem;
  return {
    docId,
    docType: coerceDocType(fm.doc_type),
    domain: asArray(fm.domain),
    platforms: asArray(fm.platforms),
    metrics: asArray(fm.metrics),
    triggerPhrases: asArray(fm.trigger_phrases),
    volatility: coerceVolatility(fm.volatility),
    lastReviewed: (typeof fm.last_reviewed === "string" && fm.last_reviewed) || "",
    body,
    bodyLower: body.toLowerCase(),
  };
}

let cache: RagDoc[] | null = null;

/**
 * Load + parse every corpus markdown file into typed RagDocs. Memoized for the
 * process. Never throws: an unreadable corpus directory yields an empty array
 * (logged once), so retrieval degrades to "no doctrine" rather than crashing.
 */
export function loadCorpus(): RagDoc[] {
  if (cache) return cache;
  let docs: RagDoc[] = [];
  try {
    const dir = resolveCorpusDir();
    if (!dir) {
      console.warn(
        "[rag] corpus directory not found in any known location (tsx/dev or standalone trace) — degrading to empty corpus",
      );
      cache = [];
      return cache;
    }
    const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".md"));
    docs = files.map((file) => {
      const stem = file.replace(/\.md$/i, "");
      return parseDoc(stem, readFileSync(join(dir, file), "utf8"));
    });
    docs.sort((a, b) => a.docId.localeCompare(b.docId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[rag] corpus load failed (degrading to empty corpus): ${msg}`);
    docs = [];
  }
  cache = docs;
  return docs;
}

/** Look up a single doc by id (case-insensitive). */
export function getDoc(docId: string): RagDoc | undefined {
  const target = docId.toLowerCase();
  return loadCorpus().find((d) => d.docId.toLowerCase() === target);
}

/** Test-only: drop the memoized corpus so a reload re-reads disk. */
export function __resetCorpusCache(): void {
  cache = null;
}
