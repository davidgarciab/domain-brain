import { describe, expect, it, vi } from "vitest";
import { cloudflare } from "~/.server/registrars/cloudflare";
import { godaddy } from "~/.server/registrars/godaddy";
import { porkbun } from "~/.server/registrars/porkbun";
import { RegistrarError } from "~/.server/registrars/types";

// Response shapes follow each provider's published docs/OpenAPI spec (2026-11).

type Handler = (url: URL, init: RequestInit) => Response;
function fakeFetch(handler: Handler) {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) =>
    handler(new URL(String(input instanceof Request ? input.url : input)), init),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}
const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

describe("cloudflare", () => {
  const creds = { accountId: "0123456789abcdef0123456789abcdef", apiToken: "cf-token" };
  const reg = (name: string, extra = {}) => ({
    domain_name: name,
    created_at: "2025-01-15T10:00:00Z",
    expires_at: "2027-01-15T10:00:00Z",
    auto_renew: true,
    locked: true,
    privacy_mode: "redaction",
    status: "active",
    ...extra,
  });

  it("lists registrations across cursor pages", async () => {
    const fetch = fakeFetch((url, init) => {
      expect(url.pathname).toBe(`/client/v4/accounts/${creds.accountId}/registrar/registrations`);
      expect(header(init, "authorization")).toBe("Bearer cf-token");
      const cursor = url.searchParams.get("cursor");
      return Response.json({
        success: true,
        errors: [],
        messages: [],
        result: cursor ? [reg("Second.dev", { auto_renew: false })] : [reg("example.com")],
        result_info: { count: 1, per_page: 50, cursor: cursor ? "" : "abc" },
      });
    });
    expect(await cloudflare.listDomains(creds, fetch)).toEqual([
      {
        name: "example.com",
        expiresAt: "2027-01-15",
        registeredAt: "2025-01-15",
        autoRenew: true,
        nameservers: null,
        renewalPriceMinor: null,
        currency: null,
      },
      expect.objectContaining({ name: "second.dev", autoRenew: false }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, 10000, "Authentication error"], // real response for an unknown token
    [400, 9106, "Authentication failed (status: 400)"], // real response for a malformed token
    [403, 10000, "Authentication error"],
  ])("explains auth failures (HTTP %i, code %i)", async (status, code, message) => {
    const fetch = fakeFetch(() =>
      Response.json(
        { success: false, errors: [{ code, message }], messages: [], result: null },
        { status },
      ),
    );
    await expect(cloudflare.verify(creds, fetch)).rejects.toThrow(/rejected the API token/);
  });

  it("validates credentials shape", () => {
    expect(
      cloudflare.credentialsSchema.safeParse({ accountId: "nope", apiToken: "x" }).success,
    ).toBe(false);
  });
});

describe("porkbun", () => {
  const creds = { apiKey: "pk1_a", secretApiKey: "sk1_b" };
  const domain = (name: string, extra = {}) => ({
    domain: name,
    status: "ACTIVE",
    tld: name.split(".").at(-1),
    createDate: "2021-01-15 10:00:00",
    addedDate: "2026-10-16 07:06:17",
    expireDate: "2027-01-15 10:00:00",
    securityLock: 1,
    whoisPrivacy: 1,
    autoRenew: 1,
    apiAccess: 1,
    notLocal: 0,
    ...extra,
  });

  it("pages through listAll in chunks of 1000", async () => {
    const fetch = fakeFetch((url, init) => {
      expect(url.pathname).toBe("/api/json/v3/domain/listAll");
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ apikey: "pk1_a", secretapikey: "sk1_b" });
      const domains =
        body.start === 0
          ? Array.from({ length: 1000 }, (_, i) => domain(`d${i}.com`))
          : [domain("last.com", { autoRenew: "0" })];
      return Response.json({ status: "SUCCESS", count: domains.length, domains });
    });
    const list = await porkbun.listDomains(creds, fetch);
    expect(list).toHaveLength(1001);
    expect(list[0]).toEqual({
      name: "d0.com",
      expiresAt: "2027-01-15",
      registeredAt: "2021-01-15",
      autoRenew: true,
      nameservers: null,
      renewalPriceMinor: null,
      currency: null,
    });
    expect(list.at(-1)).toMatchObject({ name: "last.com", autoRenew: false });
  });

  it("surfaces Porkbun's error message", async () => {
    const fetch = fakeFetch(() =>
      Response.json(
        { status: "ERROR", message: "Invalid API key. (001)", code: "INVALID_API_KEYS_001" },
        { status: 400 },
      ),
    );
    await expect(porkbun.verify(creds, fetch)).rejects.toThrow("Porkbun: Invalid API key. (001)");
  });
});

describe("godaddy", () => {
  const summary = (domain: string, extra = {}) => ({
    domain,
    domainId: 1,
    status: "ACTIVE",
    expires: "2027-03-01T00:00:00.000Z",
    createdAt: "2019-03-01T12:00:00.000Z",
    renewAuto: true,
    locked: true,
    nameServers: ["NS1.Example.NET", "ns2.example.net"],
    ...extra,
  });

  it("uses a PAT or sso-key, pages with marker, and skips domains that left the account", async () => {
    const auths: (string | null)[] = [];
    const fetch = fakeFetch((url, init) => {
      auths.push(header(init, "authorization"));
      expect(url.searchParams.get("includes")).toBe("nameServers");
      const marker = url.searchParams.get("marker");
      if (!marker)
        return Response.json(Array.from({ length: 1000 }, (_, i) => summary(`a${i}.com`)));
      expect(marker).toBe("a999.com");
      return Response.json([
        summary("gone.com", { status: "TRANSFERRED_OUT" }),
        summary("expired.com", { status: "EXPIRED", renewAuto: false }),
      ]);
    });
    const list = await godaddy.listDomains(
      godaddy.credentialsSchema.parse({ token: "pat-123" }),
      fetch,
    );
    expect(list).toHaveLength(1001);
    expect(list[0]?.nameservers).toEqual(["ns1.example.net", "ns2.example.net"]);
    expect(list.at(-1)).toMatchObject({ name: "expired.com", autoRenew: false });
    expect(auths[0]).toBe("Bearer pat-123");

    await godaddy.verify(godaddy.credentialsSchema.parse({ apiKey: "k", apiSecret: "s" }), fetch);
    expect(auths.at(-1)).toBe("sso-key k:s");
  });

  it("requires a token or a key and secret", () => {
    expect(godaddy.credentialsSchema.safeParse({ apiKey: "k" }).success).toBe(false);
  });

  it("explains access restrictions", async () => {
    const fetch = fakeFetch(() =>
      Response.json(
        { code: "ACCESS_DENIED", message: "Authenticated user is not allowed access" },
        { status: 403 },
      ),
    );
    await expect(godaddy.verify({ token: "t", apiKey: "", apiSecret: "" }, fetch)).rejects.toThrow(
      /requirements/,
    );
  });
});

describe("network failures", () => {
  it("become readable RegistrarErrors", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    await expect(porkbun.verify({ apiKey: "a", secretApiKey: "b" }, fetch)).rejects.toBeInstanceOf(
      RegistrarError,
    );
    const limited = (async () =>
      new Response("", { status: 429 })) as unknown as typeof globalThis.fetch;
    await expect(
      cloudflare.verify({ accountId: "0".repeat(32), apiToken: "t" }, limited),
    ).rejects.toThrow(/rate limiting/);
  });
});
