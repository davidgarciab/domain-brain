import { describe, expect, it } from "vitest";
import { daysUntil, isDateString, todayUtc } from "./dates";

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
