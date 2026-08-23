export class SeoBadRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SeoBadRequestError";
  }
}

export class SeoValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SeoValidationError";
  }
}

export class SeoNotFoundError extends Error {
  readonly code = "not_found" as const;

  constructor(resource: "brand" | "task" | "proposal") {
    super(`${resource.charAt(0).toUpperCase()}${resource.slice(1)} not found`);
    this.name = "SeoNotFoundError";
  }
}

export class SeoConflictError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly currentVersion?: number,
  ) {
    super(message);
    this.name = "SeoConflictError";
  }
}

export class SeoUnavailableError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SeoUnavailableError";
  }
}
