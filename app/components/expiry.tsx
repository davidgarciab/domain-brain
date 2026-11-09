import { daysUntil, formatDate } from "~/lib/dates";
import { Badge } from "./ui";

/** Only shown when it needs attention: expired, or within 90 days. */
export const BADGE_WITHIN_DAYS = 90;

export function ExpiryBadge({ expiresAt, today }: { expiresAt: string | null; today: string }) {
  if (!expiresAt) return null;
  const days = daysUntil(expiresAt, today);
  if (days < 0) return <Badge tone="danger">Expired {-days}d ago</Badge>;
  if (days === 0) return <Badge tone="danger">Expires today</Badge>;
  if (days <= 30) return <Badge tone="warning">{days}d left</Badge>;
  if (days <= BADGE_WITHIN_DAYS) return <Badge>{days}d left</Badge>;
  return null;
}

export function ExpiryDate({ expiresAt }: { expiresAt: string | null }) {
  return expiresAt ? (
    <time dateTime={expiresAt}>{formatDate(expiresAt)}</time>
  ) : (
    <span className="text-gray-500">Unknown</span>
  );
}
