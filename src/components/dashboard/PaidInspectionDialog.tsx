"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function PaidInspectionDialog({ titleId, onClose, children }: {
  titleId: string;
  onClose: () => void;
  children: ReactNode;
}): React.JSX.Element | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => setHost(document.body), []);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!host || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    // Native modality traps focus and makes background content inert, including other portals.
    dialog.showModal();
    document.body.style.overflow = "hidden";
    dialog.querySelector<HTMLButtonElement>("[data-inspection-close]")?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [host]);

  if (!host) return null;
  return createPortal(
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="fixed inset-y-0 left-auto right-0 m-0 h-[100dvh] max-h-none w-full max-w-[1100px] overflow-y-auto overscroll-contain border-0 bg-surface-page p-0 text-ink-900 shadow-modal backdrop:bg-black/20"
    >
      <div className="min-h-full">{children}</div>
    </dialog>,
    host,
  );
}
