import { calendarDateKey, zonedDateTimeToIso } from "@/lib/time/zoned";
import type { PaidCampaignSnapshotV1 } from "./types";
import { PaidDraftValidationError } from "./validation";

export interface GeneratedPaidSchedule {
  startsDate: string;
  startsTime: string;
  durationDays: number;
}

function addCalendarDays(date: string, days: number): string {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

export function suggestedPaidSchedule(now: Date, timezone: string): GeneratedPaidSchedule {
  return {
    startsDate: addCalendarDays(calendarDateKey(now, timezone), 1),
    startsTime: "09:00",
    durationDays: 7,
  };
}

/** End dates and DST offsets are calculated, never left to model arithmetic. */
export function resolveGeneratedPaidSchedule(
  value: unknown,
  timezone: string,
): PaidCampaignSnapshotV1["schedule"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid generated schedule");
  }
  const schedule = value as Record<string, unknown>;
  if (
    Object.keys(schedule).some((key) => !["startsDate", "startsTime", "durationDays"].includes(key)) ||
    typeof schedule.startsDate !== "string" ||
    typeof schedule.startsTime !== "string" ||
    typeof schedule.durationDays !== "number" ||
    !Number.isInteger(schedule.durationDays) ||
    schedule.durationDays < 1 || schedule.durationDays > 365
  ) {
    throw new Error("Invalid generated schedule");
  }
  const startsAt = zonedDateTimeToIso(schedule.startsDate, schedule.startsTime, timezone);
  const endsAt = zonedDateTimeToIso(
    addCalendarDays(schedule.startsDate, schedule.durationDays),
    schedule.startsTime,
    timezone,
  );
  return { startsAt, endsAt, timezone };
}

export function assertPaidScheduleCurrent(
  schedule: PaidCampaignSnapshotV1["schedule"],
  now: Date,
  requireFutureStart = true,
): void {
  const field = requireFutureStart ? "startsAt" : "endsAt";
  if (!(Date.parse(schedule[field]) > now.getTime())) {
    throw new PaidDraftValidationError(
      "schedule_in_past",
      requireFutureStart
        ? "Choose a future campaign start date and time before marking it ready or approving creation."
        : "This campaign has ended. An expired schedule cannot be activated.",
      `schedule.${field}`,
    );
  }
}
