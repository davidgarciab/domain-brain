import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { createDb, type DbHandle, type Dialect } from "~/.server/db";

/**
 * Dialects to run DB tests against: SQLite always, Postgres when TEST_DATABASE_URL is set.
 * Use with `describe.each(testDialects())`.
 */
export function testDialects(): Dialect[] {
  return process.env.TEST_DATABASE_URL ? ["sqlite", "postgres"] : ["sqlite"];
}

/**
 * A fresh, empty database: in-memory SQLite, or an isolated Postgres schema.
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
  const schema = `test_${randomBytes(6).toString("hex")}`;

  const admin = createDb(baseUrl);
  await sql`create schema ${sql.id(schema)}`.execute(admin.db);
  await admin.db.destroy();

  const url = new URL(baseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const handle = createDb(url.toString());
  return {
    ...handle,
    cleanup: async () => {
      await sql`drop schema ${sql.id(schema)} cascade`.execute(handle.db);
      await handle.db.destroy();
    },
  };
}
