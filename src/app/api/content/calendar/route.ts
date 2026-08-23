import { NextResponse, type NextRequest } from "next/server";

import {
  contentApiFailure,
  databaseUnavailable,
  requireContentAccess,
} from "@/app/api/content/_lib/http";
import { getContentCalendar } from "@/lib/content/service";
import { parseCalendarRange } from "@/lib/content/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;
  try {
    const access = await requireContentAccess();
    const { searchParams } = request.nextUrl;
    const range = parseCalendarRange(searchParams.get("start"), searchParams.get("end"));
    const calendar = await getContentCalendar({
      workspaceId: access.workspace.id,
      ...range,
    });
    return NextResponse.json({ calendar });
  } catch (error) {
    return contentApiFailure(error, "calendar_load");
  }
}
