import { createLivenessResponse } from "@/lib/operations/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(): Response {
  return createLivenessResponse();
}
