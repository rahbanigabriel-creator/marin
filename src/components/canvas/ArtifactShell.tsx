/** riseIn-animated card wrapper shared by Answer Canvas artifacts. */
export function ArtifactShell({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`animate-riseIn ${className}`} style={style}>
      {children}
    </div>
  );
}
