const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function dateParts(value: Date, timezone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function offsetMinutesAt(value: Date, timezone: string): number {
  const parts = dateParts(value, timezone);
  const representedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((representedAsUtc - value.getTime()) / 60_000);
}

export function calendarDateKey(value: Date, timezone: string): string {
  const parts = dateParts(value, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function wallClockFromIso(
  value: string,
  timezone: string,
): { date: string; time: string } {
  const parts = dateParts(new Date(value), timezone);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** Convert a wall-clock value in an IANA zone to an ISO instant with an explicit offset. */
export function zonedDateTimeToIso(date: string, time: string, timezone: string): string {
  if (!DATE_KEY.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error("A valid date and time are required.");
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let offset = offsetMinutesAt(new Date(wallAsUtc), timezone);
  let instant = new Date(wallAsUtc - offset * 60_000);
  const resolvedOffset = offsetMinutesAt(instant, timezone);
  if (resolvedOffset !== offset) {
    offset = resolvedOffset;
    instant = new Date(wallAsUtc - offset * 60_000);
  }

  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  const offsetText = `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  const iso = `${date}T${time}:00${offsetText}`;
  const resolved = wallClockFromIso(iso, timezone);
  if (resolved.date !== date || resolved.time !== time) {
    throw new Error("That local time does not exist in the selected timezone.");
  }
  return iso;
}
