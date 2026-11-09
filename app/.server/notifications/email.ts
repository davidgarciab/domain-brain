import { formatDate } from "~/lib/dates";
import type { EmailMessage } from "./mailer";

export type ExpiryAlert = {
  domainId: string;
  /** Unicode display name */
  displayName: string;
  expiresAt: string;
  daysLeft: number;
  autoRenew: boolean | null;
  registrarName: string | null;
};

export function expiryPhrase(daysLeft: number): string {
  if (daysLeft < -1) return `expired ${-daysLeft} days ago`;
  if (daysLeft === -1) return "expired yesterday";
  if (daysLeft === 0) return "expires today";
  if (daysLeft === 1) return "expires tomorrow";
  return `expires in ${daysLeft} days`;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function details(a: ExpiryAlert): string {
  const parts = [formatDate(a.expiresAt)];
  if (a.autoRenew !== null) parts.push(`auto-renew ${a.autoRenew ? "on" : "off"}`);
  if (a.registrarName) parts.push(a.registrarName);
  return parts.join(" · ");
}

/** One digest email per user per run. */
export function renderExpiryEmail(
  user: { name: string; email: string },
  alerts: ExpiryAlert[],
  appUrl: string,
): EmailMessage {
  const sorted = [...alerts].sort((a, b) => a.daysLeft - b.daysLeft);
  const base = appUrl.replace(/\/$/, "");
  const link = (a: ExpiryAlert) => `${base}/domains/${a.domainId}`;
  const [first] = sorted;
  const subject =
    sorted.length === 1 && first
      ? `${first.displayName} ${expiryPhrase(first.daysLeft)}`
      : `${sorted.length} domains need attention`;
  const greeting = user.name ? `Hi ${user.name},` : "Hi,";
  const settingsUrl = `${base}/settings`;

  const text = [
    greeting,
    "",
    sorted.length === 1
      ? "This domain needs your attention:"
      : "These domains need your attention:",
    "",
    ...sorted.flatMap((a) => [
      `- ${a.displayName} ${expiryPhrase(a.daysLeft)} (${details(a)})`,
      `  ${link(a)}`,
    ]),
    "",
    `You get these emails because expiry reminders are on. Change them at ${settingsUrl}`,
    "",
  ].join("\n");

  const items = sorted
    .map(
      (a) =>
        `<li style="margin:0 0 12px"><a href="${escapeHtml(link(a))}" style="font-weight:600;color:#111">${escapeHtml(a.displayName)}</a> ${escapeHtml(expiryPhrase(a.daysLeft))}<br><span style="color:#666;font-size:13px">${escapeHtml(details(a))}</span></li>`,
    )
    .join("");
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px">
<p>${escapeHtml(greeting)}</p>
<p>${sorted.length === 1 ? "This domain needs your attention:" : "These domains need your attention:"}</p>
<ul style="padding-left:20px">${items}</ul>
<p style="color:#666;font-size:13px;margin-top:32px">You get these emails because expiry reminders are on. <a href="${escapeHtml(settingsUrl)}" style="color:#666">Change them</a>.</p>
</body></html>`;

  return { to: user.email, subject, text, html };
}
