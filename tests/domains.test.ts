import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "~/.server/db";
import {
  countDomains,
  createDomain,
  DomainExistsError,
  type DomainInput,
  deleteDomain,
  getDomain,
  listDomains,
  listTags,
  updateDomain,
} from "~/.server/domains/service";
import { createMigratedTestDb, insertUser, testDialects } from "./helpers/db";

const input = (overrides: Partial<DomainInput> = {}): DomainInput => ({
  name: "example.com",
  registrarName: null,
  registeredAt: null,
  expiresAt: null,
  autoRenew: null,
  renewalPriceMinor: null,
  currency: null,
  notes: null,
  tags: [],
  ...overrides,
});

describe.each(testDialects())("domain service on %s", (dialect) => {
  let handle: DbHandle & { cleanup: () => Promise<void> };
  let alice: string;
  let bob: string;

  beforeEach(async () => {
    handle = await createMigratedTestDb(dialect);
    alice = await insertUser(handle, "alice@example.com");
    bob = await insertUser(handle, "bob@example.com");
  });
  afterEach(async () => {
    await handle.cleanup();
  });

  it("creates and reads a domain", async () => {
    const created = await createDomain(
      handle.db,
      alice,
      input({
        name: "xn--bcher-kva.example",
        registrarName: "Porkbun",
        expiresAt: "2027-01-01",
        autoRenew: true,
        renewalPriceMinor: 1099,
        currency: "USD",
        tags: ["Personal", "side project"],
      }),
    );
    expect(created).toMatchObject({
      name: "xn--bcher-kva.example",
      displayName: "bücher.example",
      source: "manual",
      registrarName: "Porkbun",
      expiresAt: "2027-01-01",
      autoRenew: true,
      renewalPriceMinor: 1099,
      currency: "USD",
      nameservers: [],
      tags: ["personal", "side project"],
    });
    expect(await getDomain(handle.db, alice, created.id)).toEqual(created);
  });

  it("rejects duplicates per user, but not across users", async () => {
    await createDomain(handle.db, alice, input());
    await expect(createDomain(handle.db, alice, input())).rejects.toThrow(DomainExistsError);
    await expect(createDomain(handle.db, bob, input())).resolves.toBeDefined();
  });

  it("scopes every operation to the owner", async () => {
    const d = await createDomain(handle.db, alice, input({ tags: ["x"] }));
    expect(await getDomain(handle.db, bob, d.id)).toBeNull();
    expect(await listDomains(handle.db, bob)).toEqual([]);
    expect(await listTags(handle.db, bob)).toEqual([]);
    expect(await updateDomain(handle.db, bob, d.id, input({ notes: "hacked" }))).toBeNull();
    expect(await deleteDomain(handle.db, bob, d.id)).toBe(false);
    expect((await getDomain(handle.db, alice, d.id))?.notes).toBeNull();
  });

  it("lists by expiry (unknown last), searches, and filters by tag", async () => {
    await createDomain(handle.db, alice, input({ name: "later.com", expiresAt: "2028-01-01" }));
    await createDomain(handle.db, alice, input({ name: "unknown.com", tags: ["work"] }));
    await createDomain(
      handle.db,
      alice,
      input({
        name: "soon.dev",
        expiresAt: "2026-12-01",
        registrarName: "Porkbun",
        tags: ["work"],
      }),
    );
    await createDomain(handle.db, bob, input({ name: "bobs.com", expiresAt: "2026-01-01" }));

    expect(await countDomains(handle.db, alice)).toBe(3);
    const all = await listDomains(handle.db, alice);
    expect(all.map((d) => d.name)).toEqual(["soon.dev", "later.com", "unknown.com"]);

    expect((await listDomains(handle.db, alice, { q: "LATER" })).map((d) => d.name)).toEqual([
      "later.com",
    ]);
    expect((await listDomains(handle.db, alice, { q: "pork" })).map((d) => d.name)).toEqual([
      "soon.dev",
    ]);
    expect(await listDomains(handle.db, alice, { q: "%" })).toEqual([]);
    await createDomain(handle.db, alice, input({ name: "xn--bcher-kva.example" }));
    expect((await listDomains(handle.db, alice, { q: "Bü" })).map((d) => d.name)).toEqual([
      "xn--bcher-kva.example",
    ]);
    expect((await listDomains(handle.db, alice, { tag: "work", q: "soon" })).length).toBe(1);
    expect((await listDomains(handle.db, alice, { tag: "work" })).map((d) => d.name)).toEqual([
      "soon.dev",
      "unknown.com",
    ]);
    expect(await listTags(handle.db, alice)).toEqual([{ name: "work", count: 2 }]);
  });

  it("updates fields and tags, cleaning up unused tags", async () => {
    const d = await createDomain(handle.db, alice, input({ tags: ["old"] }));
    const updated = await updateDomain(
      handle.db,
      alice,
      d.id,
      input({
        expiresAt: "2030-05-05",
        autoRenew: false,
        renewalPriceMinor: 500,
        currency: "EUR",
        notes: "renew manually",
        tags: ["new"],
      }),
    );
    expect(updated).toMatchObject({
      name: "example.com",
      expiresAt: "2030-05-05",
      autoRenew: false,
      renewalPriceMinor: 500,
      currency: "EUR",
      notes: "renew manually",
      tags: ["new"],
    });
    expect(await listTags(handle.db, alice)).toEqual([{ name: "new", count: 1 }]);
  });

  it("does not let users edit registrar-owned fields on synced domains", async () => {
    const d = await createDomain(handle.db, alice, input({ expiresAt: "2027-01-01" }));
    await handle.db
      .updateTable("domain")
      .set({ source: "registrar" })
      .where("id", "=", d.id)
      .execute();

    const updated = await updateDomain(
      handle.db,
      alice,
      d.id,
      input({ expiresAt: "2099-01-01", registrarName: "Fake", notes: "mine" }),
    );
    expect(updated).toMatchObject({ expiresAt: "2027-01-01", registrarName: null, notes: "mine" });
  });

  it("deletes a domain with its tag links", async () => {
    const d = await createDomain(handle.db, alice, input({ tags: ["a"] }));
    expect(await deleteDomain(handle.db, alice, d.id)).toBe(true);
    expect(await getDomain(handle.db, alice, d.id)).toBeNull();
    expect(await listTags(handle.db, alice)).toEqual([]);
  });
});
