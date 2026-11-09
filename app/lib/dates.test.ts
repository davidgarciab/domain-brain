import { describe, expect, it } from "vitest";
import { addDays, daysUntil, isDateString, isTimeZone, localNow, todayUtc } from "./dates";

describe("dates", () => {
  it("counts days", () => {
    expect(daysUntil("2026-11-10", "2026-11-09")).toBe(1);
    expect(daysUntil("2026-11-09", "2026-11-09")).toBe(0);
    expect(daysUntil("2026-10-09", "2026-11-09")).toBe(-31);
    expect(daysUntil("2027-03-29", "2027-03-27")).toBe(2); // across DST in many zones
  });

  it("validates date strings", () => {
    expect(isDateString("2026-02-28")).toBe(true);
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("2026-2-3")).toBe(false);
  });

  it("todayUtc", () => {
    expect(todayUtc(new Date("2026-11-09T23:30:00-05:00"))).toBe("2026-11-10");
  });
});

describe("localNow / addDays", () => {
  it("computes the local date and hour", () => {
    const now = new Date("2026-11-09T23:30:00Z");
    expect(localNow("UTC", now)).toEqual({ date: "2026-11-09", hour: 23 });
    expect(localNow("Europe/Madrid", now)).toEqual({ date: "2026-11-10", hour: 0 });
    expect(localNow("America/Los_Angeles", now)).toEqual({ date: "2026-11-09", hour: 15 });
    expect(localNow("Not/AZone", now)).toEqual({ date: "2026-11-09", hour: 23 });
  });

  it("adds days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("validates timezones", () => {
    expect(isTimeZone("Europe/Madrid")).toBe(true);
    expect(isTimeZone("Mars/Base")).toBe(false);
  });
});
