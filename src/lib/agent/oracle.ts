/**
 * Deterministic groundedness oracle (architecture §4). Verifies that every
 * numeric figure stated in the lead is supported by the internal data — either
 * present directly, or a one-step derivation (pairwise sum / difference, or a
 * ratio rendered as % or ×) of figures that ARE present. This catches gross
 * hallucinations (a fabricated baseline, an invented spend) while tolerating the
 * arithmetic a real analyst does ("24%" = leak ÷ spend, "€7,750" = two leaks
 * summed). It runs in code, outside the model's trust boundary.
 *
 * Heuristic v1. Known limits: multi-step derivations (3+ operands) and figures
 * legitimately computed from data not in the snapshot can false-flag; the action
 * on a flag is a single corrective regeneration (not a hard block), so a
 * false-flag costs one retry, never a wrong answer shown.
 */
export interface GroundednessResult {
  ok: boolean;
  /** distinct figure tokens from the lead not supported by the data */
  unverified: string[];
}

const NUM_RE = /€?\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn|×|x|%)?/gi;

function parseFigure(token: string): number | null {
  let body = token.trim().toLowerCase().replace(/[€,\s]/g, "");
  let scale = 1;
  if (/k$/.test(body)) scale = 1_000;
  else if (/m$/.test(body)) scale = 1_000_000;
  else if (/bn$/.test(body)) scale = 1_000_000_000;
  body = body.replace(/(k|m|bn|×|x|%)$/g, "");
  const n = Number(body);
  return Number.isFinite(n) ? n * scale : null;
}

function extractFigures(text: string): { raw: string; value: number }[] {
  const out: { raw: string; value: number }[] = [];
  for (const m of text.match(NUM_RE) ?? []) {
    const value = parseFigure(m);
    if (value !== null) out.push({ raw: m.trim(), value });
  }
  return out;
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * 0.02); // 2% relative + 0.5 absolute
}

function isSupported(value: number, anchors: number[]): boolean {
  if (anchors.some((a) => close(value, a))) return true; // direct
  for (let i = 0; i < anchors.length; i++) {
    for (let j = 0; j < anchors.length; j++) {
      if (i === j) continue;
      const a = anchors[i];
      const b = anchors[j];
      if (close(value, a + b) || close(value, Math.abs(a - b))) return true; // sum / diff
      if (b !== 0 && (close(value, a / b) || close(value, (a / b) * 100))) return true; // ratio / %
    }
  }
  return false;
}

export function checkGroundedness(lead: string, data: string): GroundednessResult {
  const anchors = extractFigures(data).map((f) => f.value);
  if (anchors.length === 0) return { ok: true, unverified: [] };
  const unverified = extractFigures(lead)
    .filter((f) => !isSupported(f.value, anchors))
    .map((f) => f.raw);
  return { ok: unverified.length === 0, unverified: [...new Set(unverified)] };
}
