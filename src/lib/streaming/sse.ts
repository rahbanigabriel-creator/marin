import type { StreamEvent } from "@/lib/streaming/events";

export interface ParsedSseChunk {
  events: StreamEvent[];
  remainder: string;
}

/**
 * Parse every complete SSE frame in a text chunk while preserving an incomplete
 * trailing frame for the next network read. The parser deliberately accepts
 * comments/other SSE fields and joins multiple data lines per the SSE format.
 */
export function parseSseChunk(previous: string, chunk: string): ParsedSseChunk {
  let buffer = previous + chunk;
  const events: StreamEvent[] = [];
  let boundary = buffer.indexOf("\n\n");

  while (boundary >= 0) {
    const frame = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");

    if (data) {
      try {
        events.push(JSON.parse(data) as StreamEvent);
      } catch {
        throw new Error("Marpin received a malformed response. Retry to continue.");
      }
    }
    boundary = buffer.indexOf("\n\n");
  }

  return { events, remainder: buffer };
}
