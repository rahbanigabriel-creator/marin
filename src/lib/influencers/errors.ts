export class InfluencerNotFoundError extends Error {
  readonly code = "not_found" as const;

  constructor(readonly resource: "brand" | "profile" | "tracking_link") {
    super(`Influencer ${resource.replace("_", " ")} not found`);
    this.name = "InfluencerNotFoundError";
  }
}

export class InfluencerConflictError extends Error {
  constructor(
    readonly code:
      | "identity_conflict"
      | "request_conflict"
      | "version_conflict",
    message: string,
    readonly currentVersion?: number,
  ) {
    super(message);
    this.name = "InfluencerConflictError";
  }
}

export class InfluencerUnavailableError extends Error {
  readonly code = "influencer_unavailable" as const;

  constructor(message = "The influencer workspace is temporarily unavailable") {
    super(message);
    this.name = "InfluencerUnavailableError";
  }
}

export class InfluencerLimitExceededError extends Error {
  readonly code = "influencer_limit_exceeded" as const;

  constructor(
    readonly resource: "profiles" | "outreach_drafts" | "tracking_links",
    readonly limit: number,
    readonly planId: "free" | "solo",
  ) {
    super(
      `The ${planId} plan limit of ${limit} influencer ${resource.replace("_", " ")} has been reached`,
    );
    this.name = "InfluencerLimitExceededError";
  }
}
