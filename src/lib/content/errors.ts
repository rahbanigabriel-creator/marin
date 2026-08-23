export class ContentValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ContentValidationError";
  }
}

export class ContentNotFoundError extends Error {
  readonly code = "not_found" as const;

  constructor(resource: "brand" | "plan" | "content_item" | "asset") {
    const label = resource === "brand"
      ? "Brand"
      : resource === "plan"
        ? "Plan"
        : resource === "asset"
          ? "Asset"
          : "Content item";
    super(`${label} not found`);
    this.name = "ContentNotFoundError";
  }
}

export class ContentVersionConflictError extends Error {
  readonly code = "version_conflict" as const;

  constructor(readonly currentVersion: number) {
    super("The content item changed since it was loaded");
    this.name = "ContentVersionConflictError";
  }
}

export class ContentStateConflictError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ContentStateConflictError";
  }
}

export class ContentIdempotencyConflictError extends ContentStateConflictError {
  constructor() {
    super(
      "idempotency_conflict",
      "This request identifier was already used for a different handoff",
    );
    this.name = "ContentIdempotencyConflictError";
  }
}
