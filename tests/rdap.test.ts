import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbHandle } from "~/.server/db";
import { createDomain, type DomainInput, getDomain } from "~/.server/domains/service";
import {
  BOOTSTRAP_URL,
  createRdapClient,
  parseRdapDomain,
  RdapError,
  RdapRateLimitedError,
} from "~/.server/rdap/client";
import { rdapUpdate, refreshDomain, refreshStaleDomains } from "~/.server/rdap/refresh";
import { createMigratedTestDb, insertUser, testDialects } from "./helpers/db";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/rdap", name), "utf8"));

const github = fixture("github.com.json");

function fakeFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === BOOTSTRAP_URL) return Response.json(fixture("bootstrap.json"));
    const route = routes[url];
    return route ? route() : new Response("not found", { status: 404 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("parseRdapDomain", () => {
  it("extracts dates, registrar, nameservers and statuses", () => {
    expect(parseRdapDomain(github)).toEqual({
      registeredAt: "2007-10-09",
      expiresAt: "2028-10-09",
      registrarName: "MarkMonitor Inc.",
      nameservers: [
        "dns1.p08.nsone.net",
        "dns2.p08.nsone.net",
        "dns3.p08.nsone.net",
        "dns4.p08.nsone.net",
        "ns-1283.awsdns-32.org",
        "ns-1707.awsdns-21.co.uk",
        "ns-421.awsdns-52.com",
        "ns-520.awsdns-01.net",
      ],
      statuses: [
        "client delete prohibited",
        "client transfer prohibited",
        "client update prohibited",
      ],
    });
  });

  it("tolerates missing sections", () => {
    expect(parseRdapDomain({ objectClassName: "domain" })).toEqual({
      registeredAt: null,
      expiresAt: null,
      registrarName: null,
      nameservers: [],
      statuses: [],
    });
  });
});

describe("rdap client", () => {
  it("looks up via the bootstrap server and caches the bootstrap", async () => {
    const fetch = fakeFetch({
      "https://rdap.verisign.com/com/v1/domain/github.com": () => Response.json(github),
    });
    const client = createRdapClient({ fetch });
    expect((await client.lookup("github.com")).expiresAt).toBe("2028-10-09");
    await client.lookup("github.com");
    expect(fetch.mock.calls.filter(([u]) => String(u) === BOOTSTRAP_URL)).toHaveLength(1);
  });

  it("maps failures to readable errors", async () => {
    const client = createRdapClient({
      fetch: fakeFetch({
        "https://rdap.verisign.com/com/v1/domain/busy.com": () => new Response("", { status: 429 }),
        "https://rdap.verisign.com/com/v1/domain/broken.com": () =>
          new Response("", { status: 500 }),
      }),
    });
    await expect(client.lookup("example.de")).rejects.toThrow(/\.de has no public RDAP/);
    await expect(client.lookup("missing.com")).rejects.toThrow(/Not found/);
    await expect(client.lookup("busy.com")).rejects.toBeInstanceOf(RdapRateLimitedError);
    await expect(client.lookup("broken.com")).rejects.toThrow(RdapError);
  });
});

describe("rdapUpdate (field ownership)", () => {
  const result = parseRdapDomain(github);
  const base = {
    id: "1",
    registrar_name: "Mine",
    registered_at: "2000-01-01",
    expires_at: "2001-01-01",
    nameservers: '["ns.mine"]',
    statuses: "[]",
  };

  it("refreshes registry facts on manual domains but keeps the user's registrar name", () => {
    expect(rdapUpdate({ ...base, source: "manual" }, result)).toEqual({
      expires_at: "2028-10-09",
      registered_at: "2007-10-09",
      nameservers: JSON.stringify(result.nameservers),
      statuses: JSON.stringify(result.statuses),
    });
    expect(rdapUpdate({ ...base, source: "manual", registrar_name: null }, result)).toMatchObject({
      registrar_name: "MarkMonitor Inc.",
    });
  });

  it("only fills empty fields on registrar-synced domains", () => {
    expect(rdapUpdate({ ...base, source: "registrar" }, result)).toEqual({
      statuses: JSON.stringify(result.statuses),
    });
  });
});

const input = (name: string): DomainInput => ({
  name,
  registrarName: null,
  registeredAt: null,
  expiresAt: null,
  autoRenew: null,
  renewalPriceMinor: null,
  currency: null,
  notes: null,
  tags: [],
});

describe.each(testDialects())("rdap refresh on %s", (dialect) => {
  let handle: DbHandle & { cleanup: () => Promise<void> };
  let userId: string;

  beforeEach(async () => {
    handle = await createMigratedTestDb(dialect);
    userId = await insertUser(handle, "a@example.com");
  });
  afterEach(async () => {
    await handle.cleanup();
  });

  it("stores lookup results and errors", async () => {
    const client = createRdapClient({
      fetch: fakeFetch({
        "https://rdap.verisign.com/com/v1/domain/github.com": () => Response.json(github),
      }),
    });
    const ok = await createDomain(handle.db, userId, input("github.com"));
    const missing = await createDomain(handle.db, userId, input("example.de"));

    await refreshDomain(handle.db, userId, ok.id, client);
    await refreshDomain(handle.db, userId, missing.id, client);

    expect(await getDomain(handle.db, userId, ok.id)).toMatchObject({
      expiresAt: "2028-10-09",
      registrarName: "MarkMonitor Inc.",
      rdapError: null,
      rdapCheckedAt: expect.any(String),
    });
    expect(await getDomain(handle.db, userId, missing.id)).toMatchObject({
      expiresAt: null,
      rdapError: expect.stringMatching(/no public RDAP/),
      rdapCheckedAt: expect.any(String),
    });
  });

  it("refreshes stale domains oldest first and stops when rate limited", async () => {
    const names = ["a.com", "b.com", "c.com", "fresh.com"];
    for (const n of names) await createDomain(handle.db, userId, input(n));
    const yesterday = new Date(Date.now() - 25 * 3600_000).toISOString();
    await handle.db
      .updateTable("domain")
      .set({ rdap_checked_at: yesterday })
      .where("name", "=", "a.com")
      .execute();
    await handle.db
      .updateTable("domain")
      .set({ rdap_checked_at: new Date().toISOString() })
      .where("name", "=", "fresh.com")
      .execute();

    const seen: string[] = [];
    const client = {
      lookup: async (name: string) => {
        seen.push(name);
        if (name === "c.com") throw new RdapRateLimitedError("slow down");
        return parseRdapDomain(github);
      },
    };
    const result = await refreshStaleDomains(handle.db, client, { concurrency: 1 });
    expect(seen).toEqual(["b.com", "c.com"]);
    expect(result).toEqual({ checked: 1, rateLimited: true });

    const again = await refreshStaleDomains(handle.db, {
      lookup: async () => parseRdapDomain(github),
    });
    expect(again).toEqual({ checked: 2, rateLimited: false }); // c.com (never checked) + a.com (stale)
  });
});
