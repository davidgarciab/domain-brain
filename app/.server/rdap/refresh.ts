import { sql } from "kysely";
import type { Db } from "../db";
import type { DomainTable } from "../db/schema";
import { logger } from "../logger";
import { type RdapClient, RdapError, RdapRateLimitedError, type RdapResult } from "./client";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

type Row = Pick<
  DomainTable,
  "id" | "source" | "registrar_name" | "registered_at" | "expires_at" | "nameservers" | "statuses"
>;

/**
 * Field ownership (docs/architecture.md → Field ownership):
 * - manual domains: registry facts (expiry, registration date, nameservers, statuses) are
 *   refreshed from RDAP whenever it has them; registrar name is only filled when empty.
 * - registrar-synced domains: the registrar wins; RDAP only fills empty fields.
 */
export function rdapUpdate(row: Row, result: RdapResult): Partial<DomainTable> {
  const registry = row.source === "manual";
  const emptyList = (json: string) => json === "[]" || json === "";
  const update: Partial<DomainTable> = {};

  if (result.expiresAt && (registry || !row.expires_at)) update.expires_at = result.expiresAt;
  if (result.registeredAt && (registry || !row.registered_at)) {
    update.registered_at = result.registeredAt;
  }
  if (result.registrarName && !row.registrar_name) update.registrar_name = result.registrarName;
  if (result.nameservers.length && (registry || emptyList(row.nameservers))) {
    update.nameservers = JSON.stringify(result.nameservers);
  }
  if (result.statuses.length && (registry || emptyList(row.statuses))) {
    update.statuses = JSON.stringify(result.statuses);
  }
  return update;
}

async function lookupAndStore(db: Db, row: Row & { name: string }, client: RdapClient) {
  const checkedAt = new Date().toISOString();
  try {
    const result = await client.lookup(row.name);
    await db
      .updateTable("domain")
      .set({ ...rdapUpdate(row, result), rdap_checked_at: checkedAt, rdap_error: null })
      .where("id", "=", row.id)
      .execute();
  } catch (error) {
    if (!(error instanceof RdapError) || error instanceof RdapRateLimitedError) throw error;
    await db
      .updateTable("domain")
      .set({ rdap_checked_at: checkedAt, rdap_error: error.message })
      .where("id", "=", row.id)
      .execute();
  }
}

const rowColumns = [
  "id",
  "name",
  "source",
  "registrar_name",
  "registered_at",
  "expires_at",
  "nameservers",
  "statuses",
] as const;

/**
 * Looks up one domain now and stores the result (or the error message).
 * Rate limiting is stored as an error too, since the user is waiting.
 */
export async function refreshDomain(
  db: Db,
  userId: string,
  id: string,
  client: RdapClient,
): Promise<void> {
  const row = await db
    .selectFrom("domain")
    .select(rowColumns)
    .where("user_id", "=", userId)
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return;
  try {
    await lookupAndStore(db, row, client);
  } catch (error) {
    const message =
      error instanceof RdapRateLimitedError ? "The registry is busy. Try again later." : null;
    if (!message) throw error;
    await db
      .updateTable("domain")
      .set({ rdap_checked_at: new Date().toISOString(), rdap_error: message })
      .where("id", "=", id)
      .execute();
  }
}

/**
 * Background job: refresh domains not checked in the last 24h, oldest first.
 * Stops early if a registry rate-limits us; the rest are picked up next run.
 */
export async function refreshStaleDomains(
  db: Db,
  client: RdapClient,
  { batchSize = 50, concurrency = 2, now = new Date() } = {},
): Promise<{ checked: number; rateLimited: boolean }> {
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  const rows = await db
    .selectFrom("domain")
    .select(rowColumns)
    .where((eb) =>
      eb.or([eb("rdap_checked_at", "is", null), eb("rdap_checked_at", "<", staleBefore)]),
    )
    .orderBy(sql`case when rdap_checked_at is null then 0 else 1 end`)
    .orderBy("rdap_checked_at")
    .limit(batchSize)
    .execute();

  let checked = 0;
  let rateLimited = false;
  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row && !rateLimited; row = queue.shift()) {
      try {
        await lookupAndStore(db, row, client);
        checked++;
      } catch (error) {
        if (error instanceof RdapRateLimitedError) {
          rateLimited = true;
          logger().warn({ domain: row.name }, "RDAP rate limited; stopping this batch");
        } else {
          logger().error({ err: error, domain: row.name }, "RDAP refresh failed");
        }
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { checked, rateLimited };
}
