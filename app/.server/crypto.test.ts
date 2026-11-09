import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto";

const secret = "s".repeat(32);

describe("crypto", () => {
  it("round-trips", () => {
    const payload = JSON.stringify({ apiKey: "pk1_abc", secret: "sk1_def" });
    expect(decrypt(encrypt(payload, secret), secret)).toBe(payload);
  });

  it("uses a random IV", () => {
    expect(encrypt("same", secret)).not.toBe(encrypt("same", secret));
  });

  it("fails with a different secret or tampered data", () => {
    const enc = encrypt("hello", secret);
    expect(() => decrypt(enc, "t".repeat(32))).toThrow();
    const [iv, tag, ct] = enc.split(".");
    const tampered = [iv, tag, Buffer.from("x").toString("base64") + ct].join(".");
    expect(() => decrypt(tampered, secret)).toThrow();
  });
});
