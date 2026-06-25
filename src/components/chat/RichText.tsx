import { Fragment } from "react";

// Lightweight inline-markdown renderer for streamed chat text. The agent's lead
// should be short and plain, but models still reach for bold, italic, and code
// spans (and the occasional heading or horizontal rule) — so we render the inline
// emphasis and quietly strip block-markdown noise instead of printing literal
// asterisks. Safe mid-stream: an unclosed marker renders as plain text until it
// closes.

const INLINE = /\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|`(.+?)`/g;

function inline(line: string, kb: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(line))) {
    if (m.index > last) nodes.push(<Fragment key={`${kb}-p${k}`}>{line.slice(last, m.index)}</Fragment>);
    if (m[1] != null || m[2] != null) {
      nodes.push(
        <strong key={`${kb}-b${k}`} className="font-semibold text-ink-900">
          {m[1] ?? m[2]}
        </strong>,
      );
    } else if (m[3] != null || m[4] != null) {
      nodes.push(<em key={`${kb}-i${k}`}>{m[3] ?? m[4]}</em>);
    } else if (m[5] != null) {
      nodes.push(
        <code key={`${kb}-c${k}`} className="rounded-[4px] bg-surface-chip px-[3px] py-[1px] font-mono text-[0.9em]">
          {m[5]}
        </code>,
      );
    }
    last = m.index + m[0].length;
    k++;
  }
  if (last < line.length) nodes.push(<Fragment key={`${kb}-end`}>{line.slice(last)}</Fragment>);
  return nodes;
}

export function RichText({
  text,
  className,
  trailing,
}: {
  text: string;
  className?: string;
  trailing?: React.ReactNode;
}) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  lines.forEach((raw, li) => {
    // Drop horizontal rules (---, ***, ___, ===).
    if (/^\s*([-*_=])\1{2,}\s*$/.test(raw)) return;
    let line = raw.replace(/^\s*#{1,6}\s+/, ""); // strip ATX heading markers
    line = line.replace(/^\s*[-*]\s+/, "• "); // bullets → •
    out.push(
      <Fragment key={`l${li}`}>
        {inline(line, `l${li}`)}
        {li < lines.length - 1 ? <br /> : null}
      </Fragment>,
    );
  });
  return (
    <span className={className}>
      {out}
      {trailing}
    </span>
  );
}
