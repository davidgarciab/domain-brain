import { uuidv7 } from "uuidv7";
import { decrypt, encrypt } from "../crypto";
import type { Db } from "../db";
import type { RegistrarConnectionTable } from "../db/schema";
import { logger } from "../logger";
import { getProvider } from "./index";
import { type Fetch, type ProviderId, RegistrarError } from "./types";

// Registrar connections and syncing (docs/architecture.md → Registrar adapters).
// Credentials are encrypted with APP_SECRET and never leave this module decrypted.

export type SyncDeps = { secret: string; fetch?: Fetch; now?: Date };

export type Connection = {
  id: string;
  provider: ProviderId;
  providerName: string;
  label: string;
  domainCount: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
};

export type SyncResult = { added: number; updated: number; missing: number };

type Row = RegistrarConnectionTable;

function toConnection(row: Row, domainCount: number): Connection {
  return {
    id: row.id,
    provider: row.provider,
    providerName: getProvider(row.provider)?.displayName ?? row.provider,
    label: row.label,
    domainCount,
    lastSyncAt: row.last_sync_at,
    lastSyncError: row.last_sync_error,
    createdAt: row.created_at,
  };
}

export async function listConnections(db: Db, userId: string): Promise<Connection[]> {
  const rows = await db
    .selectFrom("registrar_connection")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("created_at")
    .execute();
  const counts = await db
    .selectFrom("domain")
    .select(["registrar_connection_id", (eb) => eb.fn.countAll<number | string>().as("n")])
    .where("user_id", "=", userId)
    .where("registrar_connection_id", "is not", null)
    .groupBy("registrar_connection_id")
    .execute();
  const byId = new Map(counts.map((c) => [c.registrar_connection_id, Number(c.n)]));
  return rows.map((r) => toConnection(r, byId.get(r.id) ?? 0));
}

export type ConnectInput = {
  provider: ProviderId;
  label: string;
  /** Raw form values; validated with the provider's schema. */
  credentials: Record<string, string>;
};

export type ConnectResult =
  | { ok: true; connectionId: string; sync: SyncResult | { error: string } }
  | { ok: false; errors: Record<string, string> };

/**
 * Validates and verifies the credentials against the registrar, stores the connection,
 * then runs the first sync.
 */
export async function connectRegistrar(
  db: Db,
  userId: string,
  input: ConnectInput,
  deps: SyncDeps,
): Promise<ConnectResult> {
  const provider = getProvider(input.provider);
  if (!provider) return { ok: false, errors: { form: "Unknown registrar." } };

  const parsed = provider.credentialsSchema.safeParse(input.credentials);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      errors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, errors };
  }
  try {
    await provider.verify(parsed.data, deps.fetch ?? globalThis.fetch);
  } catch (error) {
    if (error instanceof RegistrarError) return { ok: false, errors: { form: error.message } };
    throw error;
  }

  const id = uuidv7();
  const now = (deps.now ?? new Date()).toISOString();
  await db
    .insertInto("registrar_connection")
    .values({
      id,
      user_id: userId,
      provider: provider.id,
      label: input.label.trim() || provider.displayName,
      credentials_enc: encrypt(JSON.stringify(parsed.data), deps.secret),
      last_sync_at: null,
      last_sync_error: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  const sync = await syncConnection(db, userId, id, deps);
  return { ok: true, connectionId: id, sync: sync ?? { error: "Connection disappeared." } };
}

/**
 * Removes a connection. Its domains stay, become manual and editable again.
 * Returns false if the connection doesn't exist for this user.
 */
export async function deleteConnection(db: Db, userId: string, id: string): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom("registrar_connection")
      .select("id")
      .where("user_id", "=", userId)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) return false;
    await trx
      .updateTable("domain")
      .set({
        source: "manual",
        registrar_connection_id: null,
        registrar_missing_since: null,
        updated_at: new Date().toISOString(),
      })
      .where("user_id", "=", userId)
      .where("registrar_connection_id", "=", id)
      .execute();
    await trx.deleteFrom("registrar_connection").where("id", "=", id).execute();
    return true;
  });
}

/**
 * Fetches the registrar's domains and applies them:
 * - upsert by (user, name); registrar-owned fields come from the registrar when it reports
 *   them; notes, tags and (unless the registrar reports it) price stay the user's;
 * - linked domains the registrar no longer lists get `registrar_missing_since` (never deleted);
 * - records last_sync_at / last_sync_error on the connection.
 * Returns null if the connection doesn't exist for this user, `{ error }` on a sync failure.
 */
export async function syncConnection(
  db: Db,
  userId: string,
  connectionId: string,
  deps: SyncDeps,
): Promise<SyncResult | { error: string } | null> {
  const row = await db
    .selectFrom("registrar_connection")
    .selectAll()
    .where("user_id", "=", userId)
    .where("id", "=", connectionId)
    .executeTakeFirst();
  if (!row) return null;
  const now = (deps.now ?? new Date()).toISOString();

  const fail = async (message: string) => {
    await db
      .updateTable("registrar_connection")
      .set({ last_sync_at: now, last_sync_error: message, updated_at: now })
      .where("id", "=", row.id)
      .execute();
    return { error: message };
  };

  const provider = getProvider(row.provider);
  if (!provider) return fail(`Unknown registrar "${row.provider}".`);

  let credentials: Record<string, string>;
  try {
    credentials = JSON.parse(decrypt(row.credentials_enc, deps.secret));
  } catch {
    return fail(
      "The stored credentials can't be decrypted (was APP_SECRET changed?). Remove this connection and add it again.",
    );
  }

  let remote: Awaited<ReturnType<typeof provider.listDomains>>;
  try {
    remote = await provider.listDomains(credentials, deps.fetch ?? globalThis.fetch);
  } catch (error) {
    if (error instanceof RegistrarError) return fail(error.message);
    logger().error({ err: error, connectionId: row.id }, "registrar sync crashed");
    return fail("Sync failed unexpectedly. Check the server logs.");
  }

  const result: SyncResult = { added: 0, updated: 0, missing: 0 };
  await db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom("domain")
      .select(["id", "name", "registrar_connection_id"])
      .where("user_id", "=", userId)
      .execute();
    const byName = new Map(existing.map((d) => [d.name, d]));
    const seen = new Set<string>();

    for (const d of remote) {
      if (seen.has(d.name)) continue;
      seen.add(d.name);
      const owned = {
        source: "registrar" as const,
        registrar_connection_id: row.id,
        registrar_name: provider.displayName,
        registrar_missing_since: null,
        ...(d.expiresAt ? { expires_at: d.expiresAt } : {}),
        ...(d.registeredAt ? { registered_at: d.registeredAt } : {}),
        ...(d.autoRenew !== null ? { auto_renew: d.autoRenew ? 1 : 0 } : {}),
        ...(d.nameservers ? { nameservers: JSON.stringify(d.nameservers) } : {}),
        ...(d.renewalPriceMinor !== null && d.currency
          ? { renewal_price_minor: d.renewalPriceMinor, currency: d.currency }
          : {}),
        updated_at: now,
      };
      const current = byName.get(d.name);
      if (current) {
        await trx.updateTable("domain").set(owned).where("id", "=", current.id).execute();
        result.updated++;
      } else {
        await trx
          .insertInto("domain")
          .values({
            id: uuidv7(),
            user_id: userId,
            name: d.name,
            registered_at: null,
            expires_at: null,
            auto_renew: null,
            renewal_price_minor: null,
            currency: null,
            nameservers: "[]",
            statuses: "[]",
            notes: null,
            rdap_checked_at: null, // picked up first by the rdap-refresh job
            rdap_error: null,
            created_at: now,
            ...owned,
          })
          .execute();
        result.added++;
      }
    }

    for (const d of existing) {
      if (d.registrar_connection_id !== row.id || seen.has(d.name)) continue;
      const update = await trx
        .updateTable("domain")
        .set({ registrar_missing_since: now, updated_at: now })
        .where("id", "=", d.id)
        .where("registrar_missing_since", "is", null)
        .executeTakeFirst();
      if (update.numUpdatedRows > 0n) result.missing++;
    }

    await trx
      .updateTable("registrar_connection")
      .set({ last_sync_at: now, last_sync_error: null, updated_at: now })
      .where("id", "=", row.id)
      .execute();
  });
  return result;
}

/** Background job: sync every connection of every user, one at a time. */
export async function syncAllConnections(
  db: Db,
  deps: SyncDeps,
): Promise<{ synced: number; failed: number }> {
  const rows = await db.selectFrom("registrar_connection").select(["id", "user_id"]).execute();
  let synced = 0;
  let failed = 0;
  for (const r of rows) {
    const res = await syncConnection(db, r.user_id, r.id, deps);
    if (res && "error" in res) failed++;
    else if (res) synced++;
  }
  return { synced, failed };
}
