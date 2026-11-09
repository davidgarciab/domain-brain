import { describe, expect, it } from "vitest";
import { formatMoney, fromMinorUnits, toMinorUnits } from "./money";

describe("money", () => {
  it("converts to minor units per currency", () => {
    expect(toMinorUnits("10.99", "USD")).toBe(1099);
    expect(toMinorUnits("10", "USD")).toBe(1000);
    expect(toMinorUnits("10.5", "EUR")).toBe(1050);
    expect(toMinorUnits("10,5", "EUR")).toBe(1050);
    expect(toMinorUnits("1500", "JPY")).toBe(1500);
    expect(toMinorUnits("0.1", "USD")).toBe(10);
  });

  it("rejects invalid amounts", () => {
    for (const bad of ["", "-1", "abc", "1.999", "1e3"])
      expect(toMinorUnits(bad, "USD")).toBeNull();
    expect(toMinorUnits("15.5", "JPY")).toBeNull();
  });

  it("formats", () => {
    expect(fromMinorUnits(1099, "USD")).toBe("10.99");
    expect(fromMinorUnits(1500, "JPY")).toBe("1500");
    expect(formatMoney(1099, "USD")).toBe("$10.99");
  });
});
