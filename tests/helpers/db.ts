import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { createDb, type DbHandle, type Dialect } from "~/.server/db";
import { migrateToLatest } from "~/.server/db/migrate";

/**
 * Dialects to run DB tests against: SQLite always, Postgres when TEST_DATABASE_URL is set.
 * Use with `describe.each(testDialects())`.
 */
export function testDialects(): Dialect[] {
  return process.env.TEST_DATABASE_URL ? ["sqlite", "postgres"] : ["sqlite"];
}

/**
 * A fresh, empty database: in-memory SQLite, or a new Postgres database.
 * Call `cleanup()` when done.
 */
export async function createTestDb(
  dialect: Dialect,
): Promise<DbHandle & { cleanup: () => Promise<void> }> {
  if (dialect === "sqlite") {
    const handle = createDb("file::memory:");
    return { ...handle, cleanup: () => handle.db.destroy() };
  }

  const baseUrl = process.env.TEST_DATABASE_URL;
  if (!baseUrl) throw new Error("TEST_DATABASE_URL is not set");
  // A whole database per test (not a schema): Kysely's introspection looks at every schema in
  // a database, so parallel tests sharing one database interfere with each other.
  const name = `test_${randomBytes(6).toString("hex")}`;

  const admin = createDb(baseUrl);
  await sql`create database ${sql.id(name)}`.execute(admin.db);

  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  const handle = createDb(url.toString());
  return {
    ...handle,
    cleanup: async () => {
      await handle.db.destroy();
      await sql`drop database ${sql.id(name)} with (force)`.execute(admin.db);
      await admin.db.destroy();
    },
  };
}

/** A fresh database with all migrations applied. */
export async function createMigratedTestDb(dialect: Dialect) {
  const handle = await createTestDb(dialect);
  await migrateToLatest(handle.db, handle.dialect);
  return handle;
}

/** Inserts a bare user row (bypassing Better Auth) and returns its id. */
export async function insertUser(handle: DbHandle, email: string): Promise<string> {
  const id = randomBytes(8).toString("hex");
  const verified = handle.dialect === "postgres" ? sql`false` : sql`0`;
  await sql`insert into "user" (id, name, email, email_verified) values (${id}, ${email}, ${email}, ${verified})`.execute(
    handle.db,
  );
  return id;
}
