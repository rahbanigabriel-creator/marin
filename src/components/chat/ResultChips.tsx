import type { ResultChip, ChipTone } from "@/types/artifacts";

function chipStyle(tone: ChipTone): React.CSSProperties {
  if (tone === "bad") return { background: "#F5E0E3", color: "#B23A4B" };
  if (tone === "good") return { background: "#E7EEE0", color: "#4C6B40" };
  if (tone === "clay") return { background: "#F2E2EA", color: "#8A4A66" };
  return { background: "#E9E8E1", color: "#6B6359" };
}

export function ResultChips({ chips }: { chips: ResultChip[] }) {
  return (
    <div className="mt-[13px] flex flex-wrap gap-[7px]">
      {chips.map((c) => (
        <span
          key={c.label}
          className="rounded-chip font-sans text-[11.5px] font-semibold"
          style={{ padding: "5px 10px", ...chipStyle(c.tone) }}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}
