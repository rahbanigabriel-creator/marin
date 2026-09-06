import { createMeasurementHandler } from "@/lib/measurement-analytics/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createMeasurementHandler();
