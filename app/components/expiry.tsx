import { daysUntil, formatDate } from "~/lib/dates";
import { Badge } from "./ui";

/** How urgent an expiry is, for colouring. */
export function ExpiryBadge({ expiresAt, today }: { expiresAt: string | null; today: string }) {
  if (!expiresAt) return <Badge>Unknown</Badge>;
  const days = daysUntil(expiresAt, today);
  if (days < 0) return <Badge tone="danger">Expired {-days}d ago</Badge>;
  if (days === 0) return <Badge tone="danger">Expires today</Badge>;
  if (days <= 30) return <Badge tone="warning">{days}d left</Badge>;
  return <Badge>{days}d left</Badge>;
}

export function ExpiryDate({ expiresAt }: { expiresAt: string | null }) {
  return expiresAt ? <time dateTime={expiresAt}>{formatDate(expiresAt)}</time> : <span>—</span>;
}
