import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbHandle } from "~/.server/db";
import { createDomain, getDomain, listDomains } from "~/.server/domains/service";
import {
  connectRegistrar,
  deleteConnection,
  listConnections,
  syncAllConnections,
  syncConnection,
} from "~/.server/registrars/service";
import { createMigratedTestDb, insertUser, testDialects } from "./helpers/db";

const SECRET = "s".repeat(40);
const creds = { apiKey: "pk1_a", secretApiKey: "sk1_b" };

/** A fake Porkbun account whose domain list the test can change. */
function porkbunAccount(initial: string[]) {
  let names = initial;
  let failing = false;
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (failing)
      return Response.json({ status: "ERROR", message: "Invalid API key. (001)" }, { status: 400 });
    if (url.endsWith("/ping")) return Response.json({ status: "SUCCESS", yourIp: "1.2.3.4" });
    return Response.json({
      status: "SUCCESS",
      domains: names.map((domain) => ({
        domain,
        status: "ACTIVE",
        createDate: "2020-05-01 00:00:00",
        expireDate: "2027-05-01 00:00:00",
        autoRenew: 1,
      })),
    });
  }) as unknown as typeof globalThis.fetch;
  return {
    fetch,
    setNames: (n: string[]) => {
      names = n;
    },
    fail: (v: boolean) => {
      failing = v;
    },
  };
}

describe.each(testDialects())("registrar sync on %s", (dialect) => {
  let handle: DbHandle & { cleanup: () => Promise<void> };
  let alice: string;

  beforeEach(async () => {
    handle = await createMigratedTestDb(dialect);
    alice = await insertUser(handle, "alice@example.com");
  });
  afterEach(async () => {
    await handle.cleanup();
  });

  const connect = (fetch: typeof globalThis.fetch, credentials: Record<string, string> = creds) =>
    connectRegistrar(
      handle.db,
      alice,
      { provider: "porkbun", label: "", credentials },
      { secret: SECRET, fetch },
    );

  it("verifies, stores encrypted credentials and imports domains", async () => {
    const account = porkbunAccount(["one.com", "Two.dev"]);
    const result = await connect(account.fetch);
    expect(result).toMatchObject({ ok: true, sync: { added: 2, updated: 0, missing: 0 } });

    const [conn] = await listConnections(handle.db, alice);
    expect(conn).toMatchObject({
      provider: "porkbun",
      label: "Porkbun",
      domainCount: 2,
      lastSyncError: null,
    });
    const stored = await handle.db
      .selectFrom("registrar_connection")
      .select("credentials_enc")
      .executeTakeFirstOrThrow();
    expect(stored.credentials_enc).not.toContain("sk1_b");

    const domains = await listDomains(handle.db, alice);
    expect(
      domains.map((d) => [d.name, d.source, d.expiresAt, d.autoRenew, d.registrarName]),
    ).toEqual([
      ["one.com", "registrar", "2027-05-01", true, "Porkbun"],
      ["two.dev", "registrar", "2027-05-01", true, "Porkbun"],
    ]);
  });

  it("rejects bad credentials without storing anything", async () => {
    const account = porkbunAccount([]);
    account.fail(true);
    expect(await connect(account.fetch)).toEqual({
      ok: false,
      errors: { form: "Porkbun: Invalid API key. (001)" },
    });
    expect(await connect(account.fetch, { apiKey: "" })).toMatchObject({
      ok: false,
      errors: { apiKey: expect.any(String), secretApiKey: expect.any(String) },
    });
    expect(await listConnections(handle.db, alice)).toEqual([]);
  });

  it("takes over a manual domain but keeps the user's notes, tags and price", async () => {
    const manual = await createDomain(handle.db, alice, {
      name: "one.com",
      registrarName: "Old",
      registeredAt: null,
      expiresAt: "2020-01-01",
      autoRenew: false,
      renewalPriceMinor: 999,
      currency: "USD",
      notes: "keep me",
      tags: ["work"],
    });
    await connect(porkbunAccount(["one.com"]).fetch);
    expect(await getDomain(handle.db, alice, manual.id)).toMatchObject({
      source: "registrar",
      registrarName: "Porkbun",
      expiresAt: "2027-05-01",
      autoRenew: true,
      renewalPriceMinor: 999,
      notes: "keep me",
      tags: ["work"],
    });
  });

  it("flags domains the registrar stops listing, and clears the flag when they return", async () => {
    const account = porkbunAccount(["one.com", "two.com"]);
    const res = await connect(account.fetch);
    if (!res.ok) throw new Error("connect failed");

    account.setNames(["one.com"]);
    expect(
      await syncConnection(handle.db, alice, res.connectionId, {
        secret: SECRET,
        fetch: account.fetch,
      }),
    ).toEqual({
      added: 0,
      updated: 1,
      missing: 1,
    });
    const two = (await listDomains(handle.db, alice)).find((d) => d.name === "two.com");
    expect(two?.registrarMissingSince).toEqual(expect.any(String));

    // Flagged only once
    expect(
      (
        await syncConnection(handle.db, alice, res.connectionId, {
          secret: SECRET,
          fetch: account.fetch,
        })
      )?.valueOf(),
    ).toMatchObject({ missing: 0 });

    account.setNames(["one.com", "two.com"]);
    await syncConnection(handle.db, alice, res.connectionId, {
      secret: SECRET,
      fetch: account.fetch,
    });
    expect(
      (await listDomains(handle.db, alice)).every((d) => d.registrarMissingSince === null),
    ).toBe(true);
  });

  it("records sync errors and keeps existing data", async () => {
    const account = porkbunAccount(["one.com"]);
    const res = await connect(account.fetch);
    if (!res.ok) throw new Error("connect failed");
    account.fail(true);
    expect(await syncAllConnections(handle.db, { secret: SECRET, fetch: account.fetch })).toEqual({
      synced: 0,
      failed: 1,
    });
    const [conn] = await listConnections(handle.db, alice);
    expect(conn?.lastSyncError).toBe("Porkbun: Invalid API key. (001)");
    expect(conn?.domainCount).toBe(1);

    account.fail(false);
    await syncAllConnections(handle.db, { secret: SECRET, fetch: account.fetch });
    expect((await listConnections(handle.db, alice))[0]?.lastSyncError).toBeNull();
  });

  it("explains when APP_SECRET changed", async () => {
    const account = porkbunAccount(["one.com"]);
    const res = await connect(account.fetch);
    if (!res.ok) throw new Error("connect failed");
    const out = await syncConnection(handle.db, alice, res.connectionId, {
      secret: "x".repeat(40),
      fetch: account.fetch,
    });
    expect(out).toEqual({ error: expect.stringMatching(/APP_SECRET/) });
  });

  it("scopes connections per user and unlinks domains on delete", async () => {
    const bob = await insertUser(handle, "bob@example.com");
    const res = await connect(porkbunAccount(["one.com"]).fetch);
    if (!res.ok) throw new Error("connect failed");

    expect(await listConnections(handle.db, bob)).toEqual([]);
    expect(await syncConnection(handle.db, bob, res.connectionId, { secret: SECRET })).toBeNull();
    expect(await deleteConnection(handle.db, bob, res.connectionId)).toBe(false);

    expect(await deleteConnection(handle.db, alice, res.connectionId)).toBe(true);
    expect(await listConnections(handle.db, alice)).toEqual([]);
    const [domain] = await listDomains(handle.db, alice);
    expect(domain).toMatchObject({
      name: "one.com",
      source: "manual",
      registrarConnectionId: null,
      expiresAt: "2027-05-01",
    });
  });

  it("takes the renewal price from registrars that report it", async () => {
    await createDomain(handle.db, alice, {
      name: "priced.com",
      registrarName: null,
      registeredAt: null,
      expiresAt: null,
      autoRenew: null,
      renewalPriceMinor: 500,
      currency: "EUR",
      notes: null,
      tags: [],
    });
    const fetch = vi.fn(async () =>
      Response.json({
        domains: [
          {
            domainName: "priced.com",
            createDate: "2023-01-15T14:30:00Z",
            expireDate: "2027-01-15T14:30:00Z",
            autorenewEnabled: true,
            renewalPrice: 12.99,
          },
        ],
      }),
    ) as unknown as typeof globalThis.fetch;
    const res = await connectRegistrar(
      handle.db,
      alice,
      { provider: "namecom", label: "", credentials: { username: "ada", token: "t" } },
      { secret: SECRET, fetch },
    );
    expect(res).toMatchObject({ ok: true, sync: { updated: 1 } });
    const [domain] = await listDomains(handle.db, alice);
    expect(domain).toMatchObject({
      registrarName: "Name.com",
      renewalPriceMinor: 1299,
      currency: "USD",
    });
  });
});
