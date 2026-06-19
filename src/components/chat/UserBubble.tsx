/** Right-aligned dark user question bubble. */
export function UserBubble({
  text,
  variant,
}: {
  text: string;
  variant: "split" | "thread";
}) {
  const isThread = variant === "thread";
  return (
    <div
      className="self-end font-sans leading-[1.5] text-surface-page"
      style={{
        maxWidth: isThread ? "80%" : "90%",
        background: "#2B2722",
        borderRadius: "14px 14px 4px 14px",
        padding: isThread ? "12px 17px" : "11px 15px",
        fontSize: isThread ? 15 : 14,
      }}
    >
      {text}
    </div>
  );
}
