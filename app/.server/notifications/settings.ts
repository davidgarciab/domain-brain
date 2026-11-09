import { z } from "zod";
import { isTimeZone } from "~/lib/dates";
import type { Db } from "../db";

export type NotificationSettings = {
  emailEnabled: boolean;
  /** Alert thresholds in days, sorted descending, e.g. [30, 7, 1]. */
  daysBefore: number[];
  /** IANA timezone used to decide what "today" is for the user. */
  timezone: string;
};

export const DEFAULT_SETTINGS: NotificationSettings = {
  emailEnabled: true,
  daysBefore: [30, 7, 1],
  timezone: "UTC",
};

export const MAX_THRESHOLDS = 5;
export const MAX_DAYS = 365;

function parseDays(json: string): number[] {
  try {
    const parsed = z.array(z.number().int().min(1).max(MAX_DAYS)).safeParse(JSON.parse(json));
    return parsed.success ? normalizeDays(parsed.data) : DEFAULT_SETTINGS.daysBefore;
  } catch {
    return DEFAULT_SETTINGS.daysBefore;
  }
}

function normalizeDays(days: number[]): number[] {
  return [...new Set(days)].sort((a, b) => b - a);
}

/** Users without a settings row get the defaults (email on, 30/7/1 days, UTC). */
export async function getNotificationSettings(
  db: Db,
  userId: string,
): Promise<NotificationSettings> {
  const row = await db
    .selectFrom("notification_settings")
    .selectAll()
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (!row) return DEFAULT_SETTINGS;
  return {
    emailEnabled: row.email_enabled === 1,
    daysBefore: parseDays(row.days_before),
    timezone: isTimeZone(row.timezone) ? row.timezone : "UTC",
  };
}

export async function saveNotificationSettings(
  db: Db,
  userId: string,
  settings: NotificationSettings,
): Promise<void> {
  const values = {
    email_enabled: settings.emailEnabled ? 1 : 0,
    days_before: JSON.stringify(normalizeDays(settings.daysBefore)),
    timezone: settings.timezone,
    updated_at: new Date().toISOString(),
  };
  await db
    .insertInto("notification_settings")
    .values({ user_id: userId, ...values })
    .onConflict((oc) => oc.column("user_id").doUpdateSet(values))
    .execute();
}

export type SettingsFormResult =
  | { ok: true; data: NotificationSettings }
  | { ok: false; errors: Partial<Record<"daysBefore" | "timezone", string>> };

export function parseSettingsForm(form: FormData): SettingsFormResult {
  const errors: Partial<Record<"daysBefore" | "timezone", string>> = {};

  const rawDays = String(form.get("daysBefore") ?? "")
    .split(/[,\s]+/)
    .filter(Boolean);
  const days = rawDays.map(Number);
  if (days.length === 0) {
    errors.daysBefore = "Enter at least one number of days, e.g. 30, 7, 1.";
  } else if (days.some((d) => !Number.isInteger(d) || d < 1 || d > MAX_DAYS)) {
    errors.daysBefore = `Use whole numbers between 1 and ${MAX_DAYS}.`;
  } else if (new Set(days).size > MAX_THRESHOLDS) {
    errors.daysBefore = `Use at most ${MAX_THRESHOLDS} reminders.`;
  }

  const timezone = String(form.get("timezone") ?? "UTC");
  if (!isTimeZone(timezone)) errors.timezone = "Choose a valid timezone.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    data: {
      emailEnabled: form.get("emailEnabled") === "on",
      daysBefore: normalizeDays(days),
      timezone,
    },
  };
}
