export class PaidDraftBadRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PaidDraftBadRequestError";
  }
}

export class PaidDraftNotFoundError extends Error {
  readonly code = "not_found" as const;

  constructor() {
    super("Paid campaign draft not found");
    this.name = "PaidDraftNotFoundError";
  }
}

export class PaidDraftConflictError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly currentVersion?: number,
  ) {
    super(message);
    this.name = "PaidDraftConflictError";
  }
}

export class PaidDraftUnavailableError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PaidDraftUnavailableError";
  }
}
