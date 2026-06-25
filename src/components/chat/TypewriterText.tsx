import { RichText } from "./RichText";

/** Typed lead text (inline-markdown rendered) with a blinking caret while streaming. */
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
    <RichText
      text={typed}
      trailing={
        caretOn ? (
          <span
            className="animate-blink ml-px inline-block align-[-2px]"
            style={{ width: 7, height: caretHeight, background: "#9A3D63" }}
          />
        ) : null
      }
    />
  );
}
