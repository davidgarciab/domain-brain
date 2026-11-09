import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "~/.server/db";
import { createDomain, type DomainInput } from "~/.server/domains/service";
import { runExpiryCheck } from "~/.server/notifications/expiry";
import type { EmailMessage, Mailer } from "~/.server/notifications/mailer";
import {
  DEFAULT_SETTINGS,
  getNotificationSettings,
  parseSettingsForm,
  saveNotificationSettings,
} from "~/.server/notifications/settings";
import { addDays } from "~/lib/dates";
import { createMigratedTestDb, insertUser, testDialects } from "./helpers/db";

const TODAY = "2026-11-09";
const at = (date: string, time = "10:00:00") => new Date(`${date}T${time}Z`);

const input = (name: string, expiresAt: string | null): DomainInput => ({
  name,
  registrarName: null,
  registeredAt: null,
  expiresAt,
  autoRenew: null,
  renewalPriceMinor: null,
  currency: null,
  notes: null,
  tags: [],
});

function fakeMailer() {
  const sent: EmailMessage[] = [];
  let failNext = false;
  const mailer: Mailer = {
    async send(message) {
      if (failNext) {
        failNext = false;
        throw new Error("SMTP down");
      }
      sent.push(message);
    },
  };
  return { mailer, sent, fail: () => (failNext = true) };
}

describe("parseSettingsForm", () => {
  const form = (values: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    return fd;
  };

  it("parses and normalizes", () => {
    expect(
      parseSettingsForm(
        form({ emailEnabled: "on", daysBefore: "7, 30 1 7", timezone: "Europe/Madrid" }),
      ),
    ).toEqual({
      ok: true,
      data: { emailEnabled: true, daysBefore: [30, 7, 1], timezone: "Europe/Madrid" },
    });
    expect(parseSettingsForm(form({ daysBefore: "14", timezone: "UTC" }))).toMatchObject({
      ok: true,
      data: { emailEnabled: false },
    });
  });

  it("rejects bad input", () => {
    expect(parseSettingsForm(form({ daysBefore: "", timezone: "UTC" })).ok).toBe(false);
    expect(parseSettingsForm(form({ daysBefore: "0", timezone: "UTC" })).ok).toBe(false);
    expect(parseSettingsForm(form({ daysBefore: "1.5", timezone: "UTC" })).ok).toBe(false);
    expect(parseSettingsForm(form({ daysBefore: "1,2,3,4,5,6", timezone: "UTC" })).ok).toBe(false);
    expect(parseSettingsForm(form({ daysBefore: "7", timezone: "Mars/Base" })).ok).toBe(false);
  });
});

describe.each(testDialects())("notifications on %s", (dialect) => {
  let handle: DbHandle & { cleanup: () => Promise<void> };
  let alice: string;

  beforeEach(async () => {
    handle = await createMigratedTestDb(dialect);
    alice = await insertUser(handle, "alice@example.com");
  });
  afterEach(async () => {
    await handle.cleanup();
  });

  const run = (mailer: Mailer, now: Date) =>
    runExpiryCheck(handle.db, mailer, { appUrl: "https://db.example.com", now });

  it("saves settings (defaults until saved)", async () => {
    expect(await getNotificationSettings(handle.db, alice)).toEqual(DEFAULT_SETTINGS);
    const settings = { emailEnabled: false, daysBefore: [14, 3], timezone: "Asia/Tokyo" };
    await saveNotificationSettings(handle.db, alice, settings);
    expect(await getNotificationSettings(handle.db, alice)).toEqual(settings);
    await saveNotificationSettings(handle.db, alice, { ...settings, emailEnabled: true });
    expect((await getNotificationSettings(handle.db, alice)).emailEnabled).toBe(true);
  });

  it("sends one digest with every due domain, once", async () => {
    await createDomain(handle.db, alice, input("in25.com", addDays(TODAY, 25)));
    await createDomain(handle.db, alice, input("in5.com", addDays(TODAY, 5)));
    await createDomain(handle.db, alice, input("in40.com", addDays(TODAY, 40)));
    await createDomain(handle.db, alice, input("expired3.com", addDays(TODAY, -3)));
    await createDomain(handle.db, alice, input("expired10.com", addDays(TODAY, -10)));
    await createDomain(handle.db, alice, input("unknown.com", null));
    const { mailer, sent } = fakeMailer();

    expect(await run(mailer, at(TODAY))).toEqual({ emailsSent: 1, alerts: 3, failures: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("alice@example.com");
    expect(sent[0]?.subject).toBe("3 domains need attention");
    expect(sent[0]?.text).toMatch(
      /expired3\.com expired 3 days ago[\s\S]*in5\.com[\s\S]*in25\.com/,
    );

    expect(await run(mailer, at(TODAY, "11:00:00"))).toEqual({
      emailsSent: 0,
      alerts: 0,
      failures: 0,
    });
  });

  it("alerts again when a domain enters the next window, catching up missed days", async () => {
    await createDomain(handle.db, alice, input("a.com", addDays(TODAY, 25)));
    const { mailer, sent } = fakeMailer();
    await run(mailer, at(TODAY)); // 30-day window
    await run(mailer, at(addDays(TODAY, 10))); // 15 left: still the 30 window
    expect(sent).toHaveLength(1);
    await run(mailer, at(addDays(TODAY, 20))); // 5 left: 7 window (day 7 itself was missed)
    expect(sent.map((m) => m.subject)).toEqual([
      "a.com expires in 25 days",
      "a.com expires in 5 days",
    ]);
  });

  it("starts over after a renewal", async () => {
    const d = await createDomain(handle.db, alice, input("a.com", addDays(TODAY, 5)));
    const { mailer, sent } = fakeMailer();
    await run(mailer, at(TODAY));
    await handle.db
      .updateTable("domain")
      .set({ expires_at: addDays(TODAY, 20) })
      .where("id", "=", d.id)
      .execute();
    await run(mailer, at(TODAY, "12:00:00"));
    expect(sent.map((m) => m.subject)).toEqual([
      "a.com expires in 5 days",
      "a.com expires in 20 days",
    ]);
  });

  it("respects local time and opt-out", async () => {
    await createDomain(handle.db, alice, input("a.com", addDays(TODAY, 5)));
    const { mailer, sent } = fakeMailer();

    await saveNotificationSettings(handle.db, alice, {
      ...DEFAULT_SETTINGS,
      timezone: "America/Los_Angeles",
    });
    await run(mailer, at(TODAY, "14:00:00")); // 06:00 in LA
    expect(sent).toHaveLength(0);
    await run(mailer, at(TODAY, "16:30:00")); // 08:30 in LA
    expect(sent).toHaveLength(1);

    await createDomain(handle.db, alice, input("b.com", addDays(TODAY, 3)));
    await saveNotificationSettings(handle.db, alice, { ...DEFAULT_SETTINGS, emailEnabled: false });
    await run(mailer, at(TODAY, "20:00:00"));
    expect(sent).toHaveLength(1);
  });

  it("retries after a send failure", async () => {
    await createDomain(handle.db, alice, input("a.com", addDays(TODAY, 5)));
    const { mailer, sent, fail } = fakeMailer();
    fail();
    expect(await run(mailer, at(TODAY))).toEqual({ emailsSent: 0, alerts: 0, failures: 1 });
    expect(await run(mailer, at(TODAY, "11:00:00"))).toEqual({
      emailsSent: 1,
      alerts: 1,
      failures: 0,
    });
    expect(sent).toHaveLength(1);
  });

  it("emails each user only about their own domains", async () => {
    const bob = await insertUser(handle, "bob@example.com");
    await createDomain(handle.db, alice, input("alice.com", addDays(TODAY, 5)));
    await createDomain(handle.db, bob, input("bob.com", addDays(TODAY, 1)));
    const { mailer, sent } = fakeMailer();
    await run(mailer, at(TODAY));
    const byRecipient = Object.fromEntries(sent.map((m) => [m.to, m.subject]));
    expect(byRecipient).toEqual({
      "alice@example.com": "alice.com expires in 5 days",
      "bob@example.com": "bob.com expires tomorrow",
    });
  });
});
