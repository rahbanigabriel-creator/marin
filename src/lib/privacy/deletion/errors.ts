export class DeletionValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DeletionValidationError";
  }
}

export class DeletionConflictError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DeletionConflictError";
  }
}

export class DeletionNotFoundError extends Error {
  readonly code = "deletion_not_found" as const;

  constructor() {
    super("Deletion request not found");
    this.name = "DeletionNotFoundError";
  }
}

export class DeletionUnavailableError extends Error {
  readonly code = "deletion_unavailable" as const;

  constructor(message = "Workspace deletion is temporarily unavailable") {
    super(message);
    this.name = "DeletionUnavailableError";
  }
}
