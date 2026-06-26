"use client";

import { useEffect, useRef, useState } from "react";
import { COLUMN_ORDER, COLUMNS, type MetricKey } from "./format";

/**
 * Column visibility menu for the campaigns table — the "edit columns" control.
 * Toggling preserves the canonical COLUMN_ORDER so columns never reshuffle.
 */

export interface ColumnChooserProps {
  visible: MetricKey[];
  onChange: (cols: MetricKey[]) => void;
}

export function ColumnChooser({ visible, onChange }: ColumnChooserProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const set = new Set(visible);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (key: MetricKey) => {
    const next = new Set(set);
    if (next.has(key)) {
      if (next.size === 1) return; // keep at least one column
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(COLUMN_ORDER.filter((k) => next.has(k)));
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="cursor-pointer rounded-[8px] font-sans text-[12.5px] font-semibold text-ink-600"
        style={{ border: "1px solid #E5E3DB", background: "#fff", padding: "6px 12px" }}
      >
        ⋮ Columns
      </button>
      {open ? (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-30 rounded-card border border-line-3 bg-surface-card p-[8px] shadow-modal"
          style={{ minWidth: 220 }}
        >
          <div className="px-[8px] pb-[6px] pt-[2px] font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-300">
            Columns
          </div>
          <div className="flex max-h-[320px] flex-col overflow-y-auto">
            {COLUMN_ORDER.map((key) => {
              const on = set.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(key)}
                  className="flex cursor-pointer items-center gap-[9px] rounded-[7px] px-[8px] py-[6px] text-left hover:bg-[#F7F6F0]"
                >
                  <span
                    className="flex h-[15px] w-[15px] items-center justify-center rounded-[4px] text-[10px] text-white"
                    style={{ background: on ? "#9A3D63" : "transparent", border: on ? "1px solid #9A3D63" : "1px solid #CFCcC2" }}
                  >
                    {on ? "✓" : ""}
                  </span>
                  <span className="font-sans text-[12.5px] text-ink-800">{COLUMNS[key].full}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
