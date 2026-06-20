"use client";

interface RangeSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** optional formatted value shown under the track */
  format?: (v: number) => string;
}

/** Plum-accented range input, reused by Onboarding and the Forecast screen. */
export function RangeSlider({ value, min, max, step, onChange, format }: RangeSliderProps) {
  return (
    <div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer"
        style={{ accentColor: "#9A3D63" }}
      />
      {format && (
        <div className="mt-[8px] text-center font-mono text-[18px] font-semibold tracking-[-0.01em] text-ink-900">
          {format(value)}
        </div>
      )}
    </div>
  );
}
