/** Typed lead text with a blinking caret while still streaming. */
export function TypewriterText({
  typed,
  caretOn,
  caretHeight = 15,
}: {
  typed: string;
  caretOn: boolean;
  caretHeight?: number;
}) {
  return (
    <>
      {typed}
      {caretOn && (
        <span
          className="animate-blink ml-px inline-block align-[-2px]"
          style={{ width: 7, height: caretHeight, background: "#9A3D63" }}
        />
      )}
    </>
  );
}
