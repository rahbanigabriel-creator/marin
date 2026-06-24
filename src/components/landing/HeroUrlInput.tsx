"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The landing hero's interactive entry point. Captures a website URL and deep-
 * links into the app (`/app?q=…`), which auto-starts the analysis. Keeps the
 * "drop your URL and watch it work" promise front-and-center for SEO visitors.
 */
export function HeroUrlInput() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function go() {
    const v = value.trim();
    const q = v ? `?q=${encodeURIComponent(v)}` : "";
    router.push(`/app${q}`);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      go();
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[560px] items-center gap-[8px] rounded-[14px] border border-line-1 bg-surface-card p-[8px_8px_8px_16px] shadow-composer">
      <input
        type="text"
        inputMode="url"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
        aria-label="Your website URL"
        placeholder="Enter your website — e.g. yourbrand.com"
        className="min-w-0 flex-1 border-none bg-transparent font-sans text-[15px] text-ink-900 outline-none placeholder:text-ink-300"
      />
      <button
        type="button"
        onClick={go}
        className="flex-none cursor-pointer whitespace-nowrap rounded-[10px] font-sans text-[14px] font-semibold text-white"
        style={{ border: "none", background: "#9A3D63", padding: "11px 18px" }}
      >
        Analyze free →
      </button>
    </div>
  );
}
