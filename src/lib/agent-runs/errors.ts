export class AgentRunNotFoundError extends Error {
  readonly code = "agent_run_not_found";
  constructor() {
    super("Agent run not found");
    this.name = "AgentRunNotFoundError";
  }
}

export class AgentRunConflictError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly currentVersion?: number,
  ) {
    super(message);
    this.name = "AgentRunConflictError";
  }
}

export class AgentRunEntitlementError extends Error {
  readonly code = "agent_runs_upgrade_required";
  constructor() {
    super("Agent runs require a plan with automated actions");
    this.name = "AgentRunEntitlementError";
  }
}

export class AgentRunUnavailableError extends Error {
  readonly code = "agent_runs_unavailable";
  constructor() {
    super("Agent runs are temporarily unavailable");
    this.name = "AgentRunUnavailableError";
  }
}
