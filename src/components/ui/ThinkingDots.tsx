/** Three staggered pulsing dots — loaders / thinking indicator. */
export function ThinkingDots({ size = 6 }: { size?: number }) {
  const dot = {
    width: size,
    height: size,
    borderRadius: "50%",
    background: "#C7A9B4",
  } as const;
  return (
    <div className="flex gap-1 py-1">
      <span className="animate-dotPulse" style={{ ...dot, animationDelay: "0s" }} />
      <span className="animate-dotPulse" style={{ ...dot, animationDelay: ".2s" }} />
      <span className="animate-dotPulse" style={{ ...dot, animationDelay: ".4s" }} />
    </div>
  );
}
