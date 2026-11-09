import { sql } from "kysely";
import { uuidv7 } from "uuidv7";
import type { Db } from "../db";
import type { DomainTable } from "../db/schema";
import { displayDomainName } from "./names";

// Every function takes `userId` and scopes all queries by it (CLAUDE.md → Architecture).

export type Domain = {
  id: string;
  /** stored form: lowercase punycode */
  name: string;
  /** Unicode form for display */
  displayName: string;
  source: "manual" | "registrar";
  registrarConnectionId: string | null;
  registrarName: string | null;
  registeredAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean | null;
  renewalPriceMinor: number | null;
  currency: string | null;
  nameservers: string[];
  statuses: string[];
  notes: string | null;
  rdapCheckedAt: string | null;
  rdapError: string | null;
  registrarMissingSince: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
};

/** Fields a user can set. `name` is only used on create (names are immutable). */
export type DomainInput = {
  name: string;
  registrarName: string | null;
  registeredAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean | null;
  renewalPriceMinor: number | null;
  currency: string | null;
  notes: string | null;
  tags: string[];
};

/**
 * Fields that a registrar connection controls on `source = "registrar"` domains.
 * They are read-only for the user there (docs/architecture.md → Field ownership).
 */
export const REGISTRAR_OWNED_FIELDS = [
  "registrarName",
  "registeredAt",
  "expiresAt",
  "autoRenew",
] as const satisfies readonly (keyof DomainInput)[];

export class DomainExistsError extends Error {
  constructor(name: string) {
    super(`${displayDomainName(name)} is already in your list.`);
  }
}

type DomainRow = DomainTable;

function parseJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function toDomain(row: DomainRow, tags: string[]): Domain {
  return {
    id: row.id,
    name: row.name,
    displayName: displayDomainName(row.name),
    source: row.source,
    registrarConnectionId: row.registrar_connection_id,
    registrarName: row.registrar_name,
    registeredAt: row.registered_at,
    expiresAt: row.expires_at,
    autoRenew: row.auto_renew === null ? null : row.auto_renew === 1,
    renewalPriceMinor: row.renewal_price_minor,
    currency: row.currency,
    nameservers: parseJsonArray(row.nameservers),
    statuses: parseJsonArray(row.statuses),
    notes: row.notes,
    rdapCheckedAt: row.rdap_checked_at,
    rdapError: row.rdap_error,
    registrarMissingSince: row.registrar_missing_since,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tags,
  };
}

/** Tag names: trimmed, lowercase, single spaces, max 32 chars, deduplicated. */
export function normalizeTags(tags: string[]): string[] {
  const out = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 32);
    if (tag) out.add(tag);
  }
  return [...out].sort();
}

async function tagsByDomain(db: Db, userId: string): Promise<Map<string, string[]>> {
  const rows = await db
    .selectFrom("domain_tag")
    .innerJoin("tag", "tag.id", "domain_tag.tag_id")
    .select(["domain_tag.domain_id", "tag.name"])
    .where("tag.user_id", "=", userId)
    .orderBy("tag.name")
    .execute();
  const map = new Map<string, string[]>();
  for (const { domain_id, name } of rows) {
    const list = map.get(domain_id);
    if (list) list.push(name);
    else map.set(domain_id, [name]);
  }
  return map;
}

async function setTags(db: Db, userId: string, domainId: string, tags: string[]): Promise<void> {
  await db.deleteFrom("domain_tag").where("domain_id", "=", domainId).execute();
  for (const name of normalizeTags(tags)) {
    let tag = await db
      .selectFrom("tag")
      .select("id")
      .where("user_id", "=", userId)
      .where("name", "=", name)
      .executeTakeFirst();
    if (!tag) {
      tag = { id: uuidv7() };
      await db
        .insertInto("tag")
        .values({ id: tag.id, user_id: userId, name, color: null, created_at: now() })
        .execute();
    }
    await db.insertInto("domain_tag").values({ domain_id: domainId, tag_id: tag.id }).execute();
  }
  // Tags exist only while some domain uses them.
  await db
    .deleteFrom("tag")
    .where("user_id", "=", userId)
    .where("id", "not in", db.selectFrom("domain_tag").select("tag_id"))
    .execute();
}

function now(): string {
  return new Date().toISOString();
}

export type ListOptions = { q?: string; tag?: string };

/**
 * Sorted by expiry (soonest first, unknown last), then name.
 * Search and tag filtering happen in memory: a user's list is small, and searching the
 * Unicode display name ("bü" → bücher.example) can't be done in SQL on punycode names.
 */
export async function listDomains(
  db: Db,
  userId: string,
  opts: ListOptions = {},
): Promise<Domain[]> {
  const rows = await db
    .selectFrom("domain")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy(sql`case when expires_at is null then 1 else 0 end`)
    .orderBy("expires_at")
    .orderBy("name")
    .execute();
  const tags = await tagsByDomain(db, userId);
  let domains = rows.map((row) => toDomain(row, tags.get(row.id) ?? []));

  const q = opts.q?.trim().toLowerCase();
  if (q) {
    domains = domains.filter(
      (d) =>
        d.displayName.includes(q) ||
        d.name.includes(q) ||
        Boolean(d.registrarName?.toLowerCase().includes(q)),
    );
  }
  if (opts.tag) {
    const tag = opts.tag;
    domains = domains.filter((d) => d.tags.includes(tag));
  }
  return domains;
}

export async function countDomains(db: Db, userId: string): Promise<number> {
  const row = await db
    .selectFrom("domain")
    .select((eb) => eb.fn.countAll<number | string | bigint>().as("count"))
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow();
  return Number(row.count); // Postgres returns count(*) as a string
}

export async function getDomain(db: Db, userId: string, id: string): Promise<Domain | null> {
  const row = await db
    .selectFrom("domain")
    .selectAll()
    .where("user_id", "=", userId)
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return null;
  const tags = await db
    .selectFrom("domain_tag")
    .innerJoin("tag", "tag.id", "domain_tag.tag_id")
    .select("tag.name")
    .where("domain_tag.domain_id", "=", id)
    .orderBy("tag.name")
    .execute();
  return toDomain(
    row,
    tags.map((t) => t.name),
  );
}

/** `input.name` must already be normalized (see names.ts). */
export async function createDomain(db: Db, userId: string, input: DomainInput): Promise<Domain> {
  const id = uuidv7();
  await db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom("domain")
      .select("id")
      .where("user_id", "=", userId)
      .where("name", "=", input.name)
      .executeTakeFirst();
    if (existing) throw new DomainExistsError(input.name);

    const timestamp = now();
    await trx
      .insertInto("domain")
      .values({
        id,
        user_id: userId,
        name: input.name,
        source: "manual",
        registrar_connection_id: null,
        registrar_name: input.registrarName,
        registered_at: input.registeredAt,
        expires_at: input.expiresAt,
        auto_renew: input.autoRenew === null ? null : Number(input.autoRenew),
        renewal_price_minor: input.renewalPriceMinor,
        currency: input.renewalPriceMinor === null ? null : input.currency,
        nameservers: "[]",
        statuses: "[]",
        notes: input.notes,
        rdap_checked_at: null,
        rdap_error: null,
        registrar_missing_since: null,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute();
    await setTags(trx, userId, id, input.tags);
  });
  const domain = await getDomain(db, userId, id);
  if (!domain) throw new Error("Domain vanished after insert");
  return domain;
}

/**
 * Updates user-editable fields. On registrar-synced domains, registrar-owned fields are
 * ignored. The name never changes. Returns null if the domain doesn't exist for this user.
 */
export async function updateDomain(
  db: Db,
  userId: string,
  id: string,
  input: Omit<DomainInput, "name">,
): Promise<Domain | null> {
  const current = await getDomain(db, userId, id);
  if (!current) return null;
  const owned = current.source === "registrar";

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("domain")
      .set({
        ...(owned
          ? {}
          : {
              registrar_name: input.registrarName,
              registered_at: input.registeredAt,
              expires_at: input.expiresAt,
              auto_renew: input.autoRenew === null ? null : Number(input.autoRenew),
            }),
        renewal_price_minor: input.renewalPriceMinor,
        currency: input.renewalPriceMinor === null ? null : input.currency,
        notes: input.notes,
        updated_at: now(),
      })
      .where("user_id", "=", userId)
      .where("id", "=", id)
      .execute();
    await setTags(trx, userId, id, input.tags);
  });
  return getDomain(db, userId, id);
}

export async function deleteDomain(db: Db, userId: string, id: string): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const result = await trx
      .deleteFrom("domain")
      .where("user_id", "=", userId)
      .where("id", "=", id)
      .executeTakeFirst();
    if (result.numDeletedRows === 0n) return false;
    await trx
      .deleteFrom("tag")
      .where("user_id", "=", userId)
      .where("id", "not in", trx.selectFrom("domain_tag").select("tag_id"))
      .execute();
    return true;
  });
}

export async function listTags(db: Db, userId: string): Promise<{ name: string; count: number }[]> {
  const rows = await db
    .selectFrom("tag")
    .innerJoin("domain_tag", "domain_tag.tag_id", "tag.id")
    .select(["tag.name", (eb) => eb.fn.countAll<number | string | bigint>().as("count")])
    .where("tag.user_id", "=", userId)
    .groupBy("tag.name")
    .orderBy("tag.name")
    .execute();
  // Postgres returns count(*) as a string.
  return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
}
