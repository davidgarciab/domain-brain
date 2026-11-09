import { describe, expect, it } from "vitest";
import { parseDomainForm } from "./form";

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

describe("parseDomainForm", () => {
  it("parses a full form", () => {
    const result = parseDomainForm(
      form({
        name: "Bücher.example",
        registrarName: " Porkbun ",
        registeredAt: "2020-01-01",
        expiresAt: "2027-01-01",
        autoRenew: "yes",
        price: "10.99",
        currency: "eur",
        notes: "",
        tags: "Personal, side project ,personal",
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: {
        name: "xn--bcher-kva.example",
        registrarName: "Porkbun",
        registeredAt: "2020-01-01",
        expiresAt: "2027-01-01",
        autoRenew: true,
        renewalPriceMinor: 1099,
        currency: "EUR",
        notes: null,
        tags: ["Personal", " side project ", "personal"],
      },
    });
  });

  it("only needs a name", () => {
    const result = parseDomainForm(form({ name: "example.com" }));
    expect(result.ok && result.data).toMatchObject({
      name: "example.com",
      autoRenew: null,
      renewalPriceMinor: null,
      currency: null,
      tags: [],
    });
  });

  it("reports field errors", () => {
    const result = parseDomainForm(
      form({ name: "not a domain", expiresAt: "2026-02-30", price: "abc", currency: "USD" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.expiresAt).toBeDefined();
    const second = parseDomainForm(form({ name: "nope", price: "abc" }));
    expect(!second.ok && second.errors).toMatchObject({
      name: expect.any(String),
      price: expect.any(String),
    });
    const third = parseDomainForm(form({ name: "a.com", price: "5", currency: "XYZ1" }));
    expect(!third.ok && third.errors.currency).toBeTruthy();
  });

  it("ignores the name when editing", () => {
    const result = parseDomainForm(form({ notes: "hi" }), { requireName: false });
    expect(result.ok && result.data.notes).toBe("hi");
  });
});
