"use client";

import { useState } from "react";
import { LuImage } from "react-icons/lu";
import { paidMediaUrl } from "./paid-media";

interface PaidCreativeMediaProps {
  src: string | null | undefined;
  alt: string;
  inspection?: boolean;
}

export function PaidCreativeMedia(props: PaidCreativeMediaProps): React.JSX.Element {
  const src = paidMediaUrl(props.src);
  return <CreativeImage key={props.src ?? "missing"} {...props} src={src} supplied={!!props.src?.trim()} />;
}

function CreativeImage({ src, alt, inspection = false, supplied }: PaidCreativeMediaProps & { supplied: boolean }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const available = !!src && !failed;
  return (
    <span className="relative flex h-full w-full items-center justify-center overflow-hidden bg-surface-panel">
      {available ? (
        // scale-down preserves native resolution for small provider thumbnails.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading={inspection ? "eager" : "lazy"}
          referrerPolicy="no-referrer"
          onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onError={() => setFailed(true)}
          className="h-full w-full object-scale-down"
        />
      ) : (
        <span className="flex flex-col items-center gap-2 px-5 text-center text-[11px] text-ink-400">
          <LuImage size={26} strokeWidth={1} aria-hidden />
          <span role="status">{supplied ? "Preview unavailable" : "No preview supplied"}</span>
          {inspection && supplied ? <span>The source image may have expired or become inaccessible.</span> : null}
        </span>
      )}
      {inspection && available ? (
        <span role="status" className="absolute bottom-2 left-2 right-2 mx-auto w-fit max-w-[calc(100%_-_1rem)] rounded-[4px] bg-white/95 px-2 py-1 text-center text-[10px] text-ink-600">
          {size ? `${size.width} x ${size.height} px${Math.max(size.width, size.height) < 512 ? " - Low-resolution preview supplied" : ""}` : "Loading preview"}
        </span>
      ) : null}
    </span>
  );
}
