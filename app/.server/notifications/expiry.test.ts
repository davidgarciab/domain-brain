import { describe, expect, it } from "vitest";
import { renderExpiryEmail } from "./email";
import { dueThreshold } from "./expiry";

describe("dueThreshold", () => {
  const t = [30, 7, 1];
  it.each([
    [45, null],
    [31, null],
    [30, 30],
    [25, 30],
    [8, 30],
    [7, 7],
    [3, 7],
    [1, 1],
    [0, 0],
    [-3, 0],
    [-7, 0],
    [-8, null],
  ])("%i days left → %s", (days, expected) => {
    expect(dueThreshold(days, t)).toBe(expected);
  });
});

describe("renderExpiryEmail", () => {
  const user = { name: "Ada", email: "ada@example.com" };
  const alert = {
    domainId: "d1",
    displayName: "bücher.example",
    expiresAt: "2026-11-16",
    daysLeft: 7,
    autoRenew: false,
    registrarName: "Porkbun",
  };

  it("uses the domain in the subject for a single alert", () => {
    const email = renderExpiryEmail(user, [alert], "https://db.example.com/");
    expect(email.to).toBe("ada@example.com");
    expect(email.subject).toBe("bücher.example expires in 7 days");
    expect(email.text).toContain("https://db.example.com/domains/d1");
    expect(email.text).toContain("Nov 16, 2026 · auto-renew off · Porkbun");
    expect(email.text).toContain("https://db.example.com/settings");
  });

  it("summarizes several alerts, soonest first, and escapes HTML", () => {
    const email = renderExpiryEmail(
      { name: "<Ada>", email: "a@example.com" },
      [alert, { ...alert, domainId: "d2", displayName: "x.com", daysLeft: -2, autoRenew: null }],
      "https://db.example.com",
    );
    expect(email.subject).toBe("2 domains need attention");
    expect(email.text.indexOf("x.com expired 2 days ago")).toBeLessThan(
      email.text.indexOf("bücher.example"),
    );
    expect(email.html).toContain("Hi &#60;Ada&#62;,");
    expect(email.html).not.toContain("<Ada>");
  });
});
