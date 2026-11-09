// Date-only values are `YYYY-MM-DD` strings (see CLAUDE.md → Database portability).

const DAY_MS = 86_400_000;

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Whole days from `from` to `date` (negative when `date` is in the past). */
export function daysUntil(date: string, from: string = todayUtc()): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** `YYYY-MM-DD` plus `days` (may be negative). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Today's date and hour in an IANA timezone. Falls back to UTC for unknown zones. */
export function localNow(timeZone: string, now: Date = new Date()): { date: string; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    return localNow("UTC", now);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** ISO timestamp → "Nov 9, 2026, 19:27 UTC" (unambiguous, same on server and client). */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${date}, ${d.toISOString().slice(11, 16)} UTC`;
}
