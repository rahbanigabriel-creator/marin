export interface RequestGate {
  begin(): number;
  isCurrent(token: number): boolean;
  invalidate(token: number): void;
}

/** Monotonic gate that prevents an older/aborted stream from mutating new UI. */
export function createRequestGate(): RequestGate {
  let current = 0;
  return {
    begin() {
      current += 1;
      return current;
    },
    isCurrent(token) {
      return token === current;
    },
    invalidate(token) {
      if (token === current) current += 1;
    },
  };
}
