import { uuidv7 } from "uuidv7";
import { addDays, daysUntil, localNow } from "~/lib/dates";
import type { Db } from "../db";
import { displayDomainName } from "../domains/names";
import { logger } from "../logger";
import { type ExpiryAlert, renderExpiryEmail } from "./email";
import type { Mailer } from "./mailer";
import { getNotificationSettings } from "./settings";

/** Expired domains are still reported (once) if they expired at most this many days ago. */
export const EXPIRED_GRACE_DAYS = 7;
/** Don't email before this local hour; anything due earlier goes out on the first run after it. */
export const SEND_AFTER_LOCAL_HOUR = 8;

/**
 * Which alert a domain is due for, or null.
 * A domain gets one alert per threshold window it enters: with [30, 7, 1] and 5 days left the
 * due threshold is 7. Missed runs therefore catch up instead of skipping an alert. Threshold 0
 * means "expires today / recently expired".
 */
export function dueThreshold(daysLeft: number, thresholds: number[]): number | null {
  if (daysLeft < -EXPIRED_GRACE_DAYS) return null;
  if (daysLeft <= 0) return 0;
  const applicable = thresholds.filter((t) => daysLeft <= t);
  return applicable.length ? Math.min(...applicable) : null;
}

export type ExpiryCheckResult = { emailsSent: number; alerts: number; failures: number };

/**
 * Hourly job. For each user with email reminders on (and past 08:00 local time), finds due
 * alerts, claims them in notification_log (the unique index makes this idempotent across
 * runs and processes), and sends one digest email. If sending fails, the claims are released
 * so the next run retries.
 */
export async function runExpiryCheck(
  db: Db,
  mailer: Mailer,
  { appUrl, now = new Date() }: { appUrl: string; now?: Date },
): Promise<ExpiryCheckResult> {
  const result: ExpiryCheckResult = { emailsSent: 0, alerts: 0, failures: 0 };
  const users = await db.selectFrom("user").select(["id", "name", "email"]).execute();

  for (const user of users) {
    const settings = await getNotificationSettings(db, user.id);
    if (!settings.emailEnabled || settings.daysBefore.length === 0) continue;
    const local = localNow(settings.timezone, now);
    if (local.hour < SEND_AFTER_LOCAL_HOUR) continue;

    const maxDays = Math.max(...settings.daysBefore);
    const domains = await db
      .selectFrom("domain")
      .select(["id", "name", "expires_at", "auto_renew", "registrar_name"])
      .where("user_id", "=", user.id)
      .where("expires_at", ">=", addDays(local.date, -EXPIRED_GRACE_DAYS))
      .where("expires_at", "<=", addDays(local.date, maxDays))
      .execute();

    const sentAt = now.toISOString();
    const claimed: (ExpiryAlert & { threshold: number })[] = [];
    for (const d of domains) {
      if (!d.expires_at) continue;
      const daysLeft = daysUntil(d.expires_at, local.date);
      const threshold = dueThreshold(daysLeft, settings.daysBefore);
      if (threshold === null) continue;
      const inserted = await db
        .insertInto("notification_log")
        .values({
          id: uuidv7(),
          domain_id: d.id,
          expires_at: d.expires_at,
          days_before: threshold,
          sent_at: sentAt,
        })
        .onConflict((oc) => oc.columns(["domain_id", "expires_at", "days_before"]).doNothing())
        .executeTakeFirst();
      if (!inserted.numInsertedOrUpdatedRows) continue; // already sent (or claimed by another process)
      claimed.push({
        threshold,
        domainId: d.id,
        displayName: displayDomainName(d.name),
        expiresAt: d.expires_at,
        daysLeft,
        autoRenew: d.auto_renew === null ? null : d.auto_renew === 1,
        registrarName: d.registrar_name,
      });
    }
    if (claimed.length === 0) continue;

    try {
      await mailer.send(renderExpiryEmail(user, claimed, appUrl));
      result.emailsSent++;
      result.alerts += claimed.length;
    } catch (error) {
      result.failures++;
      logger().error({ err: error, userId: user.id }, "sending expiry email failed; will retry");
      for (const a of claimed) {
        await db
          .deleteFrom("notification_log")
          .where("domain_id", "=", a.domainId)
          .where("expires_at", "=", a.expiresAt)
          .where("days_before", "=", a.threshold)
          .where("sent_at", "=", sentAt)
          .execute();
      }
    }
  }
  return result;
}
