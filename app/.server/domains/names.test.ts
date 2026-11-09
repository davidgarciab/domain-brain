import { describe, expect, it } from "vitest";
import { displayDomainName, InvalidDomainError, normalizeDomainName } from "./names";

describe("normalizeDomainName", () => {
  it.each([
    ["Example.COM", "example.com"],
    ["  example.com.  ", "example.com"],
    ["https://www.Example.com/path?q=1#x", "www.example.com"],
    ["example.com:8080", "example.com"],
    ["bücher.example", "xn--bcher-kva.example"],
    ["xn--bcher-kva.example", "xn--bcher-kva.example"],
    ["my-site.co.uk", "my-site.co.uk"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeDomainName(input)).toBe(expected);
  });

  it.each([
    "",
    "example",
    "exa mple.com",
    "-bad.com",
    "bad-.com",
    "a..b",
    "1.2.3.4",
    `${"a".repeat(64)}.com`,
  ])("rejects %j", (input) => {
    expect(() => normalizeDomainName(input)).toThrow(InvalidDomainError);
  });
});

describe("displayDomainName", () => {
  it("shows Unicode", () => {
    expect(displayDomainName("xn--bcher-kva.example")).toBe("bücher.example");
    expect(displayDomainName("example.com")).toBe("example.com");
  });
});
