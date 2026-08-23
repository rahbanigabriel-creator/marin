"use client";

import { useState } from "react";
import Link from "next/link";
import { LuArrowLeft, LuDownload, LuShieldCheck, LuTrash2 } from "react-icons/lu";

import { WorkspaceDeletionPanel } from "./WorkspaceDeletionPanel";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";

export function DataPrivacySettings() {
  const [deletionLocked, setDeletionLocked] = useState(false);

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-[900px] px-[20px] py-[28px] sm:px-[32px]">
      <Link href={deletionLocked ? "/" : "/app"} className={`inline-flex items-center gap-[6px] text-[12.5px] font-semibold text-ink-500 no-underline hover:text-ink-800 ${focusRing}`}>
        <LuArrowLeft aria-hidden /> {deletionLocked ? "Back to Marpin" : "Back to workspace"}
      </Link>

      <header className="border-b border-line-2 pb-[22px] pt-[28px]">
        <p className="m-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-300">Settings</p>
        <h1 className="mb-0 mt-[6px] text-[26px] font-semibold text-ink-900">Data &amp; privacy</h1>
        <p className="mb-0 mt-[7px] max-w-[620px] text-[13.5px] leading-[1.55] text-ink-400">
          Export the persisted workspace data you control and review the deletion process.
        </p>
      </header>

      <section aria-labelledby="export-heading" className="grid gap-[16px] border-b border-line-2 py-[26px] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div>
          <div className="flex items-center gap-[8px]">
            <LuShieldCheck aria-hidden className="text-pos-700" />
            <h2 id="export-heading" className="m-0 text-[18px] font-semibold text-ink-900">Workspace export</h2>
          </div>
          <p className="mb-0 mt-[7px] max-w-[610px] text-[13px] leading-[1.55] text-ink-500">
            Download a JSON copy of brand context, conversations, calendar content, SEO work, paid reporting and drafts, agent runs, influencer CRM, usage, and billing references. OAuth credentials and private storage keys are excluded.
          </p>
        </div>
        <a href="/api/settings/export" className={`inline-flex h-[38px] items-center justify-center gap-[7px] rounded-[7px] bg-ink-900 px-[13px] text-[12px] font-semibold text-white no-underline ${focusRing}`}>
          <LuDownload aria-hidden /> Download export
        </a>
      </section>

      <section aria-labelledby="deletion-heading" className="py-[26px]">
        <div>
          <div className="flex items-center gap-[8px]">
            <LuTrash2 aria-hidden className="text-neg-700" />
            <h2 id="deletion-heading" className="m-0 text-[18px] font-semibold text-ink-900">Deletion</h2>
          </div>
        </div>
        <div className="mt-4 border-t border-line-3 pt-4">
          <WorkspaceDeletionPanel onDeletionLockChange={setDeletionLocked} />
        </div>
        <Link href="/data-deletion" className={`mt-5 inline-flex h-[38px] items-center justify-center rounded-[7px] border border-line-1 bg-surface-card px-[13px] text-[12px] font-semibold text-ink-700 no-underline ${focusRing}`}>
          Read deletion details
        </Link>
      </section>
    </main>
  );
}
