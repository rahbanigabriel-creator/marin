export const HEALTH_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
} as const;

export const DEFAULT_READINESS_TIMEOUT_MS = 1_500;

export interface LivenessResult {
  status: "ok";
}

export interface ReadinessResult {
  status: "ready" | "not_ready";
  components: Array<{
    name: "database";
    status: "up" | "down";
  }>;
}

export interface ReadinessDependencies {
  pingDatabase: () => Promise<unknown>;
  timeoutMs?: number;
}

function readinessTimeout(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs) || !timeoutMs || timeoutMs < 1) {
    return DEFAULT_READINESS_TIMEOUT_MS;
  }
  return Math.min(Math.floor(timeoutMs), 10_000);
}

async function databaseStatus(
  pingDatabase: ReadinessDependencies["pingDatabase"],
  timeoutMs: number,
): Promise<"up" | "down"> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (status: "up" | "down") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };

    const timer = setTimeout(() => finish("down"), timeoutMs);

    Promise.resolve()
      .then(pingDatabase)
      .then(
        () => finish("up"),
        () => finish("down"),
      );
  });
}

export function livenessResult(): LivenessResult {
  return { status: "ok" };
}

export async function readinessResult(
  dependencies: ReadinessDependencies,
): Promise<ReadinessResult> {
  const status = await databaseStatus(
    dependencies.pingDatabase,
    readinessTimeout(dependencies.timeoutMs),
  );

  return {
    status: status === "up" ? "ready" : "not_ready",
    components: [{ name: "database", status }],
  };
}

function jsonResponse(body: LivenessResult | ReadinessResult, status: number): Response {
  return Response.json(body, {
    status,
    headers: HEALTH_RESPONSE_HEADERS,
  });
}

export function createLivenessResponse(): Response {
  return jsonResponse(livenessResult(), 200);
}

export async function createReadinessResponse(
  dependencies: ReadinessDependencies,
): Promise<Response> {
  const result = await readinessResult(dependencies);
  return jsonResponse(result, result.status === "ready" ? 200 : 503);
}
