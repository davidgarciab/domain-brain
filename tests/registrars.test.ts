import { describe, expect, it, vi } from "vitest";
import { cloudflare } from "~/.server/registrars/cloudflare";
import { gandi } from "~/.server/registrars/gandi";
import { godaddy } from "~/.server/registrars/godaddy";
import { namecom } from "~/.server/registrars/namecom";
import { porkbun } from "~/.server/registrars/porkbun";
import { spaceship } from "~/.server/registrars/spaceship";
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

describe("gandi", () => {
  const domain = (fqdn: string, extra = {}) => ({
    id: "ba1167be-2f76-11e9-9dfb-00163ec4cb00",
    fqdn,
    fqdn_unicode: fqdn,
    tld: fqdn.split(".").at(-1),
    autorenew: false,
    dates: {
      created_at: "2019-02-13T11:04:18Z",
      registry_created_at: "2019-02-13T10:04:18Z",
      registry_ends_at: "2027-02-13T10:04:18Z",
      updated_at: "2019-02-25T16:20:49Z",
    },
    nameserver: { current: "livedns" },
    status: ["clientTransferProhibited"],
    tags: [],
    ...extra,
  });

  it("pages until a short page", async () => {
    const fetch = fakeFetch((url, init) => {
      expect(url.pathname).toBe("/v5/domain/domains");
      expect(header(init, "authorization")).toBe("Bearer pat_x");
      const p = Number(url.searchParams.get("page"));
      if (p === 1) return Response.json(Array.from({ length: 100 }, (_, i) => domain(`g${i}.net`)));
      return Response.json([
        domain("external.fr", {
          autorenew: true,
          nameserver: { current: "other", hosts: ["NS1.X.FR."] },
        }),
      ]);
    });
    const list = await gandi.listDomains({ token: "pat_x" }, fetch);
    expect(list).toHaveLength(101);
    expect(list[0]).toEqual({
      name: "g0.net",
      expiresAt: "2027-02-13",
      registeredAt: "2019-02-13",
      autoRenew: false,
      nameservers: null,
      renewalPriceMinor: null,
      currency: null,
    });
    expect(list.at(-1)).toMatchObject({ autoRenew: true, nameservers: ["ns1.x.fr"] });
  });

  it("explains auth failures (real response)", async () => {
    const fetch = fakeFetch(() =>
      Response.json(
        {
          object: "HTTPForbidden",
          cause: "Forbidden",
          code: 403,
          message: "Access was denied to this resource.",
        },
        { status: 403 },
      ),
    );
    await expect(gandi.verify({ token: "bad" }, fetch)).rejects.toThrow(/Gandi rejected the token/);
  });
});

describe("name.com", () => {
  const creds = { username: "ada", token: "tok" };
  const domain = (domainName: string, extra = {}) => ({
    domainName,
    createDate: "2023-01-15T14:30:00Z",
    expireDate: "2027-01-15T14:30:00Z",
    autorenewEnabled: true,
    locked: true,
    nameservers: ["ns1.name.com", "ns2.name.com"],
    renewalPrice: 12.99,
    ...extra,
  });

  it("uses basic auth, follows nextPage and maps renewal prices", async () => {
    const fetch = fakeFetch((url, init) => {
      expect(url.pathname).toBe("/core/v1/domains");
      expect(header(init, "authorization")).toBe(
        `Basic ${Buffer.from("ada:tok").toString("base64")}`,
      );
      if (url.searchParams.get("page") === "1") {
        return Response.json({
          domains: [domain("first.com")],
          from: 1,
          to: 1,
          totalCount: 2,
          nextPage: 2,
          lastPage: 2,
        });
      }
      return Response.json({
        domains: [domain("second.io", { renewalPrice: undefined, autorenewEnabled: false })],
        from: 2,
        to: 2,
        totalCount: 2,
      });
    });
    expect(await namecom.listDomains(creds, fetch)).toEqual([
      {
        name: "first.com",
        expiresAt: "2027-01-15",
        registeredAt: "2023-01-15",
        autoRenew: true,
        nameservers: ["ns1.name.com", "ns2.name.com"],
        renewalPriceMinor: 1299,
        currency: "USD",
      },
      expect.objectContaining({
        name: "second.io",
        autoRenew: false,
        renewalPriceMinor: null,
        currency: null,
      }),
    ]);
  });

  it("explains auth failures (real response)", async () => {
    const fetch = fakeFetch(() => Response.json({ message: "Unauthorized" }, { status: 401 }));
    await expect(namecom.verify(creds, fetch)).rejects.toThrow(
      /rejected the username or API token/,
    );
  });
});

describe("spaceship", () => {
  const creds = { apiKey: "key", apiSecret: "secret" };
  const item = (name: string, extra = {}) => ({
    name,
    unicodeName: name,
    isPremium: false,
    autoRenew: true,
    registrationDate: "2024-03-01T08:00:00.000Z",
    expirationDate: "2027-03-01T08:00:00.000Z",
    lifecycleStatus: "registered",
    verificationStatus: "success",
    eppStatuses: ["clientTransferProhibited"],
    suspensions: [],
    privacyProtection: { contactForm: true, level: "high" },
    nameservers: { provider: "custom", hosts: ["ns2.example.net", "NS1.example.net"] },
    contacts: { registrant: "c1", admin: "c1", tech: "c1", billing: "c1", attributes: [] },
    ...extra,
  });

  it("sends key headers and pages with take/skip", async () => {
    const fetch = fakeFetch((url, init) => {
      expect(url.pathname).toBe("/api/v1/domains");
      expect(header(init, "x-api-key")).toBe("key");
      expect(header(init, "x-api-secret")).toBe("secret");
      const skip = Number(url.searchParams.get("skip"));
      const items =
        skip === 0
          ? Array.from({ length: 100 }, (_, i) => item(`s${i}.xyz`))
          : [item("last.xyz", { autoRenew: false, nameservers: { provider: "basic" } })];
      return Response.json({ items, total: 101 });
    });
    const list = await spaceship.listDomains(creds, fetch);
    expect(list).toHaveLength(101);
    expect(list[0]).toMatchObject({
      name: "s0.xyz",
      expiresAt: "2027-03-01",
      registeredAt: "2024-03-01",
      autoRenew: true,
      nameservers: ["ns1.example.net", "ns2.example.net"],
    });
    expect(list.at(-1)).toMatchObject({ autoRenew: false, nameservers: null });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("explains auth failures (real response)", async () => {
    const fetch = fakeFetch(() =>
      Response.json(
        { detail: "The user's request was not properly authorized." },
        { status: 401, headers: { "content-type": "application/problem+json" } },
      ),
    );
    await expect(spaceship.verify(creds, fetch)).rejects.toThrow(/rejected the API key or secret/);
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
