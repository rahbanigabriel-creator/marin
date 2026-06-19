import { Fragment } from "react";

/**
 * Renders a string with **bold** segments. Used for closing lines that
 * emphasize phrases like "TikTok Prospecting" or "€7.7k/month".
 */
export function RichLine({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <div className={className}>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold">
            {p}
          </strong>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </div>
  );
}
