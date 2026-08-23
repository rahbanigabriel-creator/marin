export type UsageSettlementState =
  | "unmetered"
  | "reserved"
  | "committing"
  | "committed"
  | "unsettled";

export class UsageSettlementError extends Error {
  constructor() {
    super("Usage could not be settled before answer delivery");
    this.name = "UsageSettlementError";
  }
}

/**
 * Gates billable stream frames behind durable usage settlement. The commit is
 * deliberately independent of the response AbortSignal: once model output has
 * been produced, disconnecting the transport cannot turn it into a free turn.
 */
export function createUsageSettlementGate(input: {
  persisted: boolean;
  commit: () => Promise<boolean>;
}) {
  let state: UsageSettlementState = input.persisted ? "reserved" : "unmetered";
  let settlement: Promise<void> | null = null;

  const ensureCommitted = async (): Promise<void> => {
    if (state === "unmetered" || state === "committed") return;
    if (state === "unsettled") throw new UsageSettlementError();

    if (!settlement) {
      state = "committing";
      settlement = input.commit().then(
        (committed) => {
          if (!committed) {
            state = "unsettled";
            throw new UsageSettlementError();
          }
          state = "committed";
        },
        () => {
          state = "unsettled";
          throw new UsageSettlementError();
        },
      );
    }
    await settlement;
  };

  return {
    async emit<T>(deliver: () => T): Promise<T> {
      await ensureCommitted();
      return deliver();
    },
    get state(): UsageSettlementState {
      return state;
    },
    shouldRelease(): boolean {
      return state === "reserved";
    },
  };
}
