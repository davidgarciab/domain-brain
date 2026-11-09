import { createTransport } from "nodemailer";
import { env } from "../env";

export type EmailMessage = { to: string; subject: string; text: string; html: string };

export type Mailer = { send: (message: EmailMessage) => Promise<void> };

export function createSmtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = createTransport(smtpUrl);
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}

let instance: Mailer | null | undefined;

/** The configured mailer, or null when SMTP_URL is unset (email disabled on this server). */
export function mailer(): Mailer | null {
  if (instance === undefined) {
    const { SMTP_URL, EMAIL_FROM } = env();
    instance = SMTP_URL ? createSmtpMailer(SMTP_URL, EMAIL_FROM) : null;
  }
  return instance;
}
