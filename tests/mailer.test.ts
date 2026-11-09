import { afterAll, beforeAll, expect, it } from "vitest";
import { renderExpiryEmail } from "~/.server/notifications/email";
import { createSmtpMailer } from "~/.server/notifications/mailer";
import { startSmtpSink } from "./helpers/smtp";

let sink: Awaited<ReturnType<typeof startSmtpSink>>;
beforeAll(async () => {
  sink = await startSmtpSink();
});
afterAll(async () => {
  await sink.close();
});

it("delivers an expiry digest over SMTP", async () => {
  const mailer = createSmtpMailer(sink.url, "Domain Brain <noreply@example.com>");
  await mailer.send(
    renderExpiryEmail(
      { name: "Ada", email: "ada@example.com" },
      [
        {
          domainId: "d1",
          displayName: "bücher.example",
          expiresAt: "2026-11-16",
          daysLeft: 7,
          autoRenew: true,
          registrarName: null,
        },
      ],
      "https://db.example.com",
    ),
  );
  expect(sink.messages).toHaveLength(1);
  const raw = sink.messages[0] ?? "";
  expect(raw).toMatch(/^From: Domain Brain <noreply@example\.com>$/m);
  expect(raw).toMatch(/^To: ada@example\.com$/m);
  expect(raw).toMatch(/^Subject: =\?UTF-8\?/m); // non-ASCII subject is encoded
  expect(raw).toContain("multipart/alternative");
});
