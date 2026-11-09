import { type Kysely, sql } from "kysely";
import { type Migration, type MigrationResultSet, Migrator } from "kysely/migration";
import type { Dialect } from "./index";

/**
 * A migration file in ./migrations exports `up` (and optionally `down`).
 * Unlike plain Kysely migrations, they also receive the dialect, for the rare
 * place where SQLite and Postgres need different column types.
 */
export type MigrationModule = {
  up: (db: Kysely<any>, dialect: Dialect) => Promise<void>;
  down?: (db: Kysely<any>, dialect: Dialect) => Promise<void>;
};

// Bundled at build time by Vite, so migrations work from the built server
// without reading the filesystem.
const modules = import.meta.glob<MigrationModule>("./migrations/*.ts", { eager: true });

export function loadMigrations(dialect: Dialect): Record<string, Migration> {
  const migrations: Record<string, Migration> = {};
  for (const [path, mod] of Object.entries(modules)) {
    const name = path.replace("./migrations/", "").replace(/\.ts$/, "");
    const { up, down } = mod;
    migrations[name] = {
      up: (db) => up(db, dialect),
      down: down ? (db) => down(db, dialect) : undefined,
    };
  }
  return migrations;
}

export async function migrateToLatest(
  db: Kysely<any>,
  dialect: Dialect,
): Promise<MigrationResultSet["results"]> {
  // On Postgres, pin Kysely's bookkeeping tables to the connection's schema. Otherwise the
  // Migrator finds a `kysely_migration` table in *any* schema (e.g. another app sharing the
  // database) and wrongly assumes ours exists.
  const migrationTableSchema =
    dialect === "postgres"
      ? (await sql<{ schema: string }>`select current_schema() as schema`.execute(db)).rows[0]
          ?.schema
      : undefined;
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => loadMigrations(dialect) },
    migrationTableSchema,
  });
  const { error, results } = await migrator.migrateToLatest();
  if (error) {
    const failed = results?.find((r) => r.status === "Error")?.migrationName;
    throw new Error(`Migration ${failed ?? "(unknown)"} failed: ${String(error)}`, {
      cause: error,
    });
  }
  return results;
}
